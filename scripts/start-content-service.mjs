import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { openContentApproval } from '../lib/content-approval.mjs';
import { openAuthIdentityVerifier } from '../lib/content-auth-handoff.mjs';
import { authenticationConfig } from '../server/auth-config.mjs';
import { openServiceAuth } from '../server/auth-store.mjs';
import { createReaderApp } from '../server/reader-http.mjs';
import { openContentReader } from '../server/content-reader.mjs';
import { openContentShareMaterials } from '../server/content-share-materials.mjs';
import { createWechatShare, wechatShareConfig } from '../server/wechat-share.mjs';

export async function startContentService(configFile) {
  const file=realpathSync(configFile), base=dirname(file);
  const c=JSON.parse(readFileSync(file,'utf8'));
  if(c.backend!=='content' || c.auth?.mode!=='required' || c.kernelConfig || c.lifecycleSocket || process.env.CONCEPT_LIFECYCLE_SOCKET) {
    throw new Error('内容服务需要独立的 HTTPS 站主配置');
  }
  // These paths are explicit so this entry never adopts the legacy workspace.
  for(const key of ['contentRelease','controlDirectory','authDirectory','libraryId','manifestSha256','checkpointSha256','agentTokenFile']) {
    if(typeof c[key]!=='string' || !c[key]) throw new Error('内容服务配置缺少 '+key);
  }
  const origin=new URL(c.publicUrl).origin;
  const auth=authenticationConfig(c,file);
  const directory=realpathSync(resolve(base,c.contentRelease));
  const controlPath=resolve(base,c.controlDirectory);
  if (!lstatSync(controlPath).isDirectory()) throw new Error('控制目录必须是独立的实体目录');
  const controls=realpathSync(controlPath);
  const authRoot=realpathSync(resolve(base,c.authDirectory));
  const roots=[directory,controls,authRoot,base];
  const nested=(parent,child)=>{
    const tail=relative(parent,child);
    return !isAbsolute(tail) && tail!=='..' && !tail.startsWith('..'+sep);
  };
  for (const [i,parent] of roots.entries()) {
    if (roots.slice(i+1).some(child=>nested(parent,child)||nested(child,parent)))
      throw new Error('内容、设置、认证卷和外部核准目录必须分开');
  }
  const agentToken=readFileSync(resolve(base,c.agentTokenFile),'utf8').trim();
  const reader=openContentReader({directory,libraryId:c.libraryId,manifestSha256:c.manifestSha256,origin});
  let verifier,store,server;
  try {
    const materials=openContentShareMaterials(resolve(directory,'share-materials'),reader);
    verifier=openAuthIdentityVerifier(auth.databasePath,c.libraryId);
    const gate=openContentApproval({controlDirectory:controls,checkpointSha256:c.checkpointSha256,manifestSha256:c.manifestSha256,
      libraryId:c.libraryId,reader,authIdentity:verifier.identity,verifyAuth:verifier.verify,materialDigest:materials.digest});
    store=openServiceAuth(auth);
    server=createReaderApp({publicUrl:origin,authMode:'required',authStore:store,agentToken,requireUIAssets:true,
      trustedProxyAddress:auth.trustedProxyAddress,contentReader:reader,contentApproval:gate,
      wechatShare:createWechatShare(wechatShareConfig(c.wechatShare,file)),getShareMaterial:materials.get});
    await new Promise((yes,no)=>{server.once('error',no);server.listen(c.port ?? 3000,c.host ?? '127.0.0.1',yes);});
  } catch(error) {store?.close();verifier?.close();reader.close();throw error;}
  server.once('close',()=>{store.close();verifier.close();reader.close();});
  return server;
}

if(process.argv[1] && pathToFileURL(resolve(process.argv[1])).href===import.meta.url) {
  const config=process.argv[2] ?? process.env.CONCEPT_SERVICE_CONFIG;
  if (!config || config==='--help') {
    console.log('node scripts/start-content-service.mjs <已核准的独立内容服务配置>');
    if(!config) process.exitCode=1;
  } else {
    const server=await startContentService(config);
    console.log('SQLite 内容服务正在监听 '+server.address().port);
    for(const signal of ['SIGINT','SIGTERM']) process.once(signal,()=>server.close());
  }
}
