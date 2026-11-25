import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { startLifecycleNginx } from './lifecycle-nginx-fixture.mjs';
let readiness = 404, unexpected = [], business = [];
const app = createServer(async (req,res)=>{
  const buffers = [];
  for await (const chunk of req) buffers.push(chunk);
  const body = Buffer.concat(buffers).toString();
  if (req.url==='/api/readiness') {
    if (req.method!=='GET' || req.headers.cookie || req.headers.authorization || body)
      unexpected.push(req.method);
    if (readiness !== null) res.writeHead(readiness).end();
  } else {
    business.push({method:req.method,path:req.url,body});
    res.writeHead(200).end('隔离合成数据');
  }
});
let proxy;
try {
  app.listen(0,'127.0.0.1');
  await once(app,'listening');
  proxy = await startLifecycleNginx(app.address().port);
  const {endpoint} = proxy;
  assert.equal((await fetch(endpoint+'/_concept_discovery_lifecycle_ready')).status,404);
  const headers = {authorization:'Bearer synthetic',cookie:'session=synthetic'};
  for (const version of [404,503]) {
    readiness = version;
    for (const path of ['/cards/synthetic','/share/synthetic','/share/synthetic/cover','/archives'])
      assert.equal((await fetch(endpoint+path,{headers})).status,500);
    for (const path of ['/api/card-share/read','/api/card-lifecycle/preview','/api/card-lifecycle/confirm'])
      assert.equal((await fetch(endpoint+path,{method:'POST',headers,body:'synthetic'})).status,500);
  }
  readiness = null;
  assert.equal((await fetch(endpoint+'/cards/synthetic',{headers,signal:AbortSignal.timeout(6500)})).status,500);
  assert.deepEqual(business,[]);
  readiness = 200;
  const confirmed = await fetch(endpoint+'/api/card-lifecycle/confirm',{method:'POST',headers,body:'synthetic approval'});
  assert.equal(confirmed.status,200);
  assert.equal(await confirmed.text(),'隔离合成数据');
  assert.deepEqual(business,[{method:'POST',path:'/api/card-lifecycle/confirm',body:'synthetic approval'}]);
  assert.deepEqual(unexpected,[]);
  console.log('PASS Nginx 在旧镜像和待恢复状态关闭访问，就绪后只向业务端转发原请求');
} finally {
  await proxy?.close();
  if (app.listening) await new Promise(resolve=>app.close(resolve));
}
