import { createConnection, createServer } from 'node:net';
import { chmodSync, lstatSync, unlinkSync } from 'node:fs';
import { dirname, isAbsolute } from 'node:path';
import { fail } from './siyuan.mjs';

const methods = new Set(['archives', 'preview', 'confirmation', 'confirm', 'status', 'syncStatus', 'draft', 'databasePreview', 'resumeSync', 'ready']);
const maxRequest = 4 * 1024 * 1024 + 4096;
const maxResponse = 2 * 1024 * 1024;

function request(socketPath, method, args) {
  return new Promise((resolve, reject) => {
    const socket = createConnection(socketPath);
    let response = '', length = 0;
    const unavailable = () => reject(Object.assign(new Error('维护服务暂不可用。'), {code:'lifecycle_unavailable'}));
    socket.setTimeout(30000, () => socket.destroy());
    socket.once('error', unavailable);
    socket.once('close', unavailable);
    socket.once('connect', () => socket.write(JSON.stringify({method,args}) + '\n'));
    socket.setEncoding('utf8');
    socket.on('data', chunk => {
      length += Buffer.byteLength(chunk);
      if (length > maxResponse) { socket.destroy(); return; }
      response += chunk;
      if (!response.endsWith('\n')) return;
      try {
        const result = JSON.parse(response);
        if (result.ok) resolve(result.data);
        else reject(Object.assign(new Error(result.message), {code:result.code}));
      } catch { unavailable(); }
      finally { socket.destroy(); }
    });
  });
}

export function cardLifecycleClient(socketPath) {
  if (!isAbsolute(socketPath)) fail('invalid_input', '维护套接字须使用绝对路径。');
  const call = method => (...args) => request(socketPath, method, args);
  return { archives:call('archives'), preview:call('preview'), confirmation:call('confirmation'),
    confirm:call('confirm'), status:call('status'), syncStatus:call('syncStatus'),
    draft:call('draft'), databasePreview:call('databasePreview'),resumeSync:call('resumeSync'),ready:()=>request(socketPath,'ready',['gateway']) };
}

/** Stale-socket recovery is only for the supervisor holding the host instance lock. */
async function reclaimSocket(socketPath) {
  const before = lstatSync(socketPath,{throwIfNoEntry:false});
  if (!before) return;
  if (!before.isSocket()) fail('outside_scope', '维护套接字路径已被其他文件占用。');
  const stale = await new Promise(resolve => {
    const socket = createConnection(socketPath);
    socket.setTimeout(2000, () => { socket.destroy(); resolve(false); });
    socket.once('connect', () => { socket.destroy(); resolve(false); });
    socket.once('error', error => resolve(error.code === 'ECONNREFUSED'));
  });
  const after = lstatSync(socketPath,{throwIfNoEntry:false});
  if (!stale || !after || after.dev !== before.dev || after.ino !== before.ino || !after.isSocket())
    fail('write_locked', '维护套接字仍在使用或已变化。');
  unlinkSync(socketPath);
}

export async function listenCardLifecycle(socketPath, worker, { reclaimUnderHostLock = false } = {}) {
  const directory = lstatSync(dirname(socketPath));
  if (!isAbsolute(socketPath) || !directory.isDirectory() || (directory.mode & 0o077))
    fail('outside_scope', '维护套接字须放在私有目录。');
  if (reclaimUnderHostLock) await reclaimSocket(socketPath);
  const server = createServer(socket => {
    let length = 0, chunks = [];
    socket.on('error', () => {});
    socket.setTimeout(30000, () => socket.destroy());
    async function dispatch(payload) {
      try {
        const {method,args} = JSON.parse(payload);
        if (!methods.has(method) || !Array.isArray(args) || typeof args[0] !== 'string')
          fail('invalid_input', '维护请求无效。');
        const data = await worker[method](...args);
        const response = JSON.stringify({ok:true,data}) + '\n';
        if (Buffer.byteLength(response) > maxResponse) fail('invalid_input', '维护响应过大。');
        socket.end(response);
      } catch (error) {
        const exposed = /^(?:invalid_(?:preview|input)|not_found|outside_scope|operation_(?:pending|conflict)|content_conflict|write_locked)$/.test(error.code ?? '');
        socket.end(JSON.stringify({ok:false,code:exposed ? error.code : 'lifecycle_unavailable',
          message:exposed ? '维护请求未能完成，请核对状态后重试。' : '维护服务暂不可用。'}) + '\n');
      }
    }
    function receive(chunk) {
      length += chunk.length;
      if (length > maxRequest) { socket.destroy(); return; }
      chunks.push(chunk);
      if (!chunk.includes(10)) return;
      socket.off('data', receive);
      const payload = Buffer.concat(chunks).toString('utf8');
      chunks = [];
      void dispatch(payload);
    }
    socket.on('data', receive);
  });
  await new Promise((accept, reject) => {
    server.once('error', reject);
    server.listen(socketPath, () => {
      server.off('error', reject);
      try { chmodSync(socketPath, 0o600); }
      catch (error) { server.close(); reject(error); return; }
      accept();
    });
  });
  return server;
}
