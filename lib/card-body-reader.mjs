import { setImmediate } from 'node:timers/promises';
import { fail, hash } from './siyuan.mjs';

const batchSize = 32;
const concurrency = 2;

// The application owns this reader. Only derived values survive a request.
export class CardBodyReader {
  #active = 0;
  #waiting = new Set();
  #derived = { tags: new Map(), graph: new Map() };

  constructor(api) {
    this.api = api;
  }

  derive(kind, key, raw, parse) {
    const cache = this.#derived[kind];
    const fingerprint = hash(raw);
    const previous = cache.get(key);
    const entry = previous?.fingerprint === fingerprint ? previous : { fingerprint, value: parse(raw) };
    cache.delete(key);
    cache.set(key, entry);
    if (cache.size > 1024) cache.delete(cache.keys().next().value);
    return entry.value;
  }

  async #acquire(signal) {
    signal.throwIfAborted();
    if (this.#active < concurrency) {
      this.#active++;
      return;
    }
    await new Promise((resolve, reject) => {
      const wake = () => {
        signal.removeEventListener('abort', abort);
        resolve();
      };
      const abort = () => {
        this.#waiting.delete(wake);
        reject(signal.reason);
      };
      this.#waiting.add(wake);
      signal.addEventListener('abort', abort, { once: true });
    });
  }

  #release() {
    const next = this.#waiting.values().next().value;
    if (next) {
      this.#waiting.delete(next);
      next();
    } else this.#active--;
  }

  async #batch(rows, options, project, allowMissing) {
    const { signal } = options;
    let bodies;
    if (this.api.markdowns) {
      try {
        bodies = await this.api.markdowns(rows.map(row => row.id), options);
        if (!bodies || typeof bodies !== 'object' || Array.isArray(bodies))
          fail('siyuan_error', '内核返回的批量正文格式无效。');
      } catch (error) {
        signal.throwIfAborted();
        // A missing block in SiYuan 3.8.9 masks the other valid bodies in the batch.
        // A transport, authorization or kernel failure affects the batch as a whole.
        if (error?.code !== 'siyuan_error' || !/\bblock not found\b/i.test(error.message)) {
          if (allowMissing) return rows.map(() => null);
          throw error;
        }
      }
    }
    const values = [];
    for (const row of rows) {
      signal.throwIfAborted();
      let raw = bodies?.[row.id];
      if (typeof raw !== 'string') {
        try {
          raw = await this.api.markdown(row.id, options);
          if (typeof raw !== 'string') fail('siyuan_error', '未能读取知识卡正文。');
        } catch (error) {
          signal.throwIfAborted();
          if (!allowMissing) throw error;
          values.push(null);
          continue;
        }
      }
      signal.throwIfAborted();
      values.push(project(row, raw));
      // Let a disconnect or another page request run between CPU-bound parses.
      await setImmediate();
    }
    return values;
  }

  async read(rows, { signal, allowMissing = false }, project) {
    const cancel = new AbortController();
    const options = { signal: signal ? AbortSignal.any([signal, cancel.signal]) : cancel.signal };
    options.signal.throwIfAborted();
    const results = new Array(rows.length);
    let next = 0;
    const worker = async () => {
      while (next < rows.length) {
        const start = next;
        next += batchSize;
        await this.#acquire(options.signal);
        try {
          options.signal.throwIfAborted();
          const values = await this.#batch(rows.slice(start, start + batchSize), options, project, allowMissing);
          for (const [offset, value] of values.entries()) results[start + offset] = value;
        } catch (error) {
          cancel.abort(error);
          throw error;
        } finally {
          this.#release();
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(concurrency, Math.ceil(rows.length / batchSize)) }, worker));
    options.signal.throwIfAborted();
    return results;
  }
}
