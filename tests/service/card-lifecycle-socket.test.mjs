import assert from 'node:assert/strict';
import test from 'node:test';
import { createConnection } from 'node:net';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { chmodSync, lstatSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { setTimeout as wait } from 'node:timers/promises';
import { cardLifecycleClient, listenCardLifecycle } from '../../lib/card-lifecycle-socket.mjs';
import { openLifecycleGateway } from '../../scripts/card-lifecycle-gateway.mjs';

test('私有套接字只允许站主接口需要的维护方法，套接字关闭时拒绝请求', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'cd-lifecycle-socket-'));
  const path = join(directory, 'worker.sock');
  t.after(() => rmSync(directory, {recursive:true, force:true}));
  chmodSync(directory, 0o755);
  await assert.rejects(listenCardLifecycle(path, {}), {code:'outside_scope'});
  chmodSync(directory, 0o700);
  let runs = 0;
  const server = await listenCardLifecycle(path, {
    archives(owner) { assert.equal(owner, 'synthetic-owner'); return ['synthetic-card']; },
    runOnce() { runs++; },
  });
  try {
    assert.equal(lstatSync(path).mode & 0o777, 0o600);
    const client = cardLifecycleClient(path);
    assert.deepEqual(await client.archives('synthetic-owner'), ['synthetic-card']);
    const denied = await new Promise((resolve, reject) => {
      const connection = createConnection(path, () => connection.write('{"method":"runOnce","args":["synthetic-owner"]}\n'));
      let body = '';
      connection.on('data', chunk => { body += chunk; });
      connection.once('end', () => resolve(JSON.parse(body)));
      connection.once('error', reject);
    });
    assert.equal(denied.code, 'invalid_input');
    assert.equal(runs, 0);
  } finally { await new Promise(resolve => server.close(resolve)); }
  await assert.rejects(cardLifecycleClient(path).archives('synthetic-owner'), {code:'lifecycle_unavailable'});
});

test('持有宿主锁的接管者可回收 SIGKILL 遗留套接字，保留仍在用的监听及其他文件', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'cd-lifecycle-reclaim-'));
  t.after(() => rmSync(directory, {recursive:true, force:true}));
  const path = join(directory,'worker.sock');
  const child = spawn(process.execPath,['--input-type=module','-e',
    `import { listenCardLifecycle } from ${JSON.stringify(new URL('../../lib/card-lifecycle-socket.mjs',import.meta.url).href)};
    await listenCardLifecycle(process.argv[1],{}); console.log('ready');`,path], {stdio:['ignore','pipe','inherit']});
  try {
    const ready = await Promise.race([once(child.stdout,'data').then(([value])=>value.toString()),
      once(child,'exit').then(()=>null)]);
    assert.match(ready,/ready/);
    await assert.rejects(listenCardLifecycle(path,{}, {reclaimUnderHostLock:true}),{code:'write_locked'});
    assert.ok(lstatSync(path).isSocket());
  } finally {
    if (child.exitCode === null && child.signalCode === null) {
      const stopped = once(child,'exit');
      child.kill('SIGKILL');
      await stopped;
    }
  }
  const listener = await listenCardLifecycle(path,{archives:()=>[]},{reclaimUnderHostLock:true});
  await new Promise(resolve=>listener.close(resolve));
  const regular = join(directory,'plain'), link = join(directory,'link');
  writeFileSync(regular,'preserve');
  symlinkSync(regular,link);
  for (const target of [regular,link])
    await assert.rejects(listenCardLifecycle(target,{}, {reclaimUnderHostLock:true}),{code:'outside_scope'});
  assert.ok(lstatSync(regular).isFile());
  assert.ok(lstatSync(link).isSymbolicLink());
});

test('定时后台线程在等待 Git 时不阻塞接入门禁，停止后立即拒绝就绪', {timeout:10000}, async t => {
  const directory = mkdtempSync(join(tmpdir(),'cd-worker-gateway-'));
  t.after(()=>rmSync(directory,{recursive:true,force:true}));
  const socket = join(directory,'worker.sock');
  const coordination = new Int32Array(new SharedArrayBuffer(4));
  const workerFile = new URL('data:text/javascript,'+encodeURIComponent([
    "import { parentPort, workerData } from 'node:worker_threads';",
    "const {readiness,coordination} = workerData;",
    "parentPort.on('message',({id,start,stop,args})=>{",
    "  if (start) return;",
    "  if (stop) { parentPort.close(); return; }",
    "  parentPort.postMessage({id,data:{owner:args[0]}});",
    "});",
    "Atomics.wait(coordination,0,0,5000);",
    "parentPort.postMessage({listening:true});",
    "Atomics.store(readiness,0,process.hrtime.bigint()+1_500_000_000n);",
    "Atomics.store(coordination,0,2);",
    "Atomics.wait(coordination,0,2,5000);",
    "Atomics.store(readiness,0,0n);",
  ].join('\n')));
  const gateway = await openLifecycleGateway(socket,workerFile,{coordination});
  const client = cardLifecycleClient(socket);
  try {
    assert.deepEqual(await client.ready(),{ready:false});
    await assert.rejects(client.archives('synthetic-owner'),{code:'lifecycle_unavailable'});
    Atomics.store(coordination,0,1);
    Atomics.notify(coordination,0);
    for (let i=0;i<200 && Atomics.load(coordination,0)!==2;i++) await wait(10);
    assert.equal(Atomics.load(coordination,0),2);
    assert.deepEqual(await Promise.race([client.ready(),wait(1000).then(()=>null)]),{ready:true});
    await wait(1500);
    assert.deepEqual(await client.ready(),{ready:false});
    Atomics.store(coordination,0,3);
    Atomics.notify(coordination,0);
    assert.deepEqual(await client.archives('synthetic-owner'),{owner:'synthetic-owner'});
    assert.deepEqual(await client.ready(),{ready:false});
  } finally {
    Atomics.store(coordination,0,3);
    Atomics.notify(coordination,0);
    await gateway.close();
  }
  await assert.rejects(client.ready(),{code:'lifecycle_unavailable'});
});
