import { lstatSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { fail } from './siyuan.mjs';

/** flock --no-fork transfers the held descriptor to this Linux process. */
export function requireInstanceFlock(path) {
  const expected = lstatSync(path,{throwIfNoEntry:false});
  if (process.platform !== 'linux' || !expected?.isFile())
    fail('write_locked','维护进程未持有指定实例的 Linux 互斥锁。');
  for (const descriptor of readdirSync('/proc/self/fd')) {
    try {
      const observed=statSync('/proc/self/fd/'+descriptor);
      if (observed.ino !== expected.ino || observed.dev !== expected.dev) continue;
      const facts=readFileSync('/proc/self/fdinfo/'+descriptor,'utf8');
      if (/^lock:\s+\d+: FLOCK\s+ADVISORY\s+WRITE\s+/m.test(facts)) return;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  fail('write_locked','维护进程未持有指定实例的 Linux 互斥锁。');
}
