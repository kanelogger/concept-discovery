import { parentPort, workerData } from 'node:worker_threads';
import { startCardLifecycle } from './start-card-lifecycle.mjs';

const {path,reconcileRecovered,readiness} = workerData;
let service, stopping = false;
const transport = {
  ready(value) { Atomics.store(readiness,0,value ? process.hrtime.bigint()+45_000_000_000n : 0n); },
  release() { parentPort.close(); },
  async finish() {
    await service?.close();
    parentPort.close();
  },
  listen(handlers) {
    const receive = async ({id,method,args,deadline,stop})=>{
      if (stop || stopping) return;
      try {
        const data = await handlers[method](args,deadline);
        parentPort.postMessage({id,data});
      } catch(error) {
        parentPort.postMessage({id,error:error.code ?? 'lifecycle_unavailable'});
      }
    };
    parentPort.on('message',receive);
    parentPort.postMessage({listening:true});
    return {close(callback) { parentPort.off('message',receive); callback(); }};
  },
};
const start = await new Promise(resolve=>parentPort.once('message',message=>resolve(message.start===true)));
if (!start) parentPort.close();
else {
  parentPort.on('message',({stop})=>{
    if (!stop) return;
    stopping = true;
    if (service) void transport.finish();
  });
  service = await startCardLifecycle(path,{reconcileRecovered,transport});
  if (stopping) await transport.finish();
}
