import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { config } from '../lib/siyuan.mjs';
import { createApp } from './app.mjs';
import { authenticationConfig } from './auth-config.mjs';
import { openServiceAuth } from './auth-store.mjs';
import { createWechatShare, wechatShareConfig } from './wechat-share.mjs';
import { cardLifecycleClient } from '../lib/card-lifecycle-socket.mjs';

export { openServiceAuth };

export function loadServiceConfig(path) {
  const file=resolve(path); const base=dirname(file);
  const c=JSON.parse(readFileSync(file,'utf8'));
  const lifecycleSocket=process.env.CONCEPT_LIFECYCLE_SOCKET??c.lifecycleSocket;
  if (process.env.CONCEPT_LIFECYCLE_SOCKET&&c.lifecycleSocket&&c.lifecycleSocket!==lifecycleSocket)
    throw new Error('恢复配置的维护套接字与部署配置不一致。');
  const secret=(p)=>readFileSync(resolve(base,p),'utf8').trim();
  return {
    host:c.host, port:c.port, publicUrl:c.publicUrl, wikiRoot:c.wikiRoot,
    auth:authenticationConfig(c,file),
    scenarioTimeoutMs:c.scenarioTimeoutMs, graphTimeoutMs:c.graphTimeoutMs,
    lifecycleSocket,
    kernelConfig:config(resolve(base,c.kernelConfig)),
    agentToken:secret(c.agentTokenFile),
    wechatShare:wechatShareConfig(c.wechatShare,file),
  };
}
export async function start(path=process.env.CONCEPT_SERVICE_CONFIG,{authStore:providedStore}={}) {
  if (!path) throw new Error('Set CONCEPT_SERVICE_CONFIG');
  const c=loadServiceConfig(path);
  if(c.lifecycleSocket&&c.auth.mode!=='required') throw new Error('卡片维护需要 HTTPS 站主认证。');
  const authStore=providedStore??openServiceAuth(c.auth);
  let server;
  try{
    server=createApp({...c,requireUIAssets:true,wechatShare:createWechatShare(c.wechatShare),authMode:c.auth.mode,authStore,
      trustedProxyAddress:c.auth.trustedProxyAddress,lifecycle:c.lifecycleSocket ? cardLifecycleClient(c.lifecycleSocket) : undefined,
      requireLifecycleReadiness:Boolean(c.lifecycleSocket)});
    await new Promise((ok,no)=>{server.once('error',no);server.listen(c.port ?? 3000,c.host ?? '127.0.0.1',ok);});
  }catch(error){
    if(!providedStore)authStore?.close();
    throw error;
  }
  server.once('close',()=>authStore?.close());
  console.log('Concept Discovery listening on '+(c.host ?? '127.0.0.1')+':'+server.address().port);
  for(const sig of ['SIGTERM','SIGINT'])process.once(sig,()=>server.close(()=>process.exit(0)));
  return server;
}
if(process.argv[1] && import.meta.url===pathToFileURL(resolve(process.argv[1])).href) await start();
