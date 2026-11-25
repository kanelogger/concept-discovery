import { Worker } from 'node:worker_threads';
import { listenCardLifecycle } from '../lib/card-lifecycle-socket.mjs';

const methods = ['archives','preview','confirmation','confirm','status','syncStatus','draft','databasePreview','resumeSync'];
const unavailable = () => Object.assign(new Error('维护进程暂不可用。'),{code:'lifecycle_unavailable'});

/** Keep the readiness socket responsive while the maintenance thread runs Git. */
export async function openLifecycleGateway(socket, workerFile, settings) {
  const readiness = new BigInt64Array(new SharedArrayBuffer(8));
  const worker = new Worker(workerFile,{workerData:{...settings,readiness}});
  const pending = new Map();
  let server, closing, exited, listening = false, serial = 0;

  function rejectPending() {
    for (const entry of pending.values()) {
      clearTimeout(entry.timer);
      entry.reject(unavailable());
    }
    pending.clear();
  }
  const stopped = new Promise(resolve=>worker.once('exit',code=>{
    exited = true;
    Atomics.store(readiness,0,0n);
    rejectPending();
    resolve();
    if (!closing) {
      process.exitCode = code || 1;
      void close();
    }
  }));
  worker.on('error',error=>console.error('维护线程退出：'+(error.code ?? 'worker_unavailable')));
  worker.on('message',({id,data,error,listening:workerListening})=>{
    if (workerListening) { listening = true; return; }
    const entry = pending.get(id);
    if (!entry) return;
    pending.delete(id);
    if (entry.timer) {
      clearTimeout(entry.timer);
      if (error) entry.reject(Object.assign(new Error('维护请求失败。'),{code:error}));
      else entry.resolve(data);
    }
  });
  function close() {
    if (!closing) closing = (async()=>{
      Atomics.store(readiness,0,0n);
      rejectPending();
      if (!exited) worker.postMessage({stop:true});
      await Promise.all([stopped,server && new Promise(resolve=>server.close(resolve))]);
    })();
    return closing;
  }
  function request(method,args) {
    if (!listening || exited || closing || pending.size >= 64) return Promise.reject(unavailable());
    const id = ++serial;
    const deadline = process.hrtime.bigint()+28_000_000_000n;
    return new Promise((resolve,reject)=>{
      const entry = {resolve,reject,timer:setTimeout(()=>{
        entry.timer = null;
        reject(unavailable());
      },29000)};
      // Reserve the slot until the background worker acknowledges the request.
      pending.set(id,entry);
      worker.postMessage({id,method,args,deadline});
    });
  }
  try {
    const service = Object.fromEntries(methods.map(method=>[method,(...args)=>request(method,args)]));
    server = await listenCardLifecycle(socket,{
      ...service,ready:()=>({ready:!closing && Atomics.load(readiness,0)>process.hrtime.bigint()}),
    },{reclaimUnderHostLock:true});
    if (exited) {
      await new Promise(resolve=>server.close(resolve));
      throw unavailable();
    }
    worker.postMessage({start:true});
    return {close};
  } catch (error) {
    await close();
    throw error;
  }
}
