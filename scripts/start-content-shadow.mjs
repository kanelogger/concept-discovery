import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import { dirname, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { authenticationConfig, isLoopback } from '../server/auth-config.mjs';
import { openServiceAuth } from '../server/auth-store.mjs';
import { createReaderApp } from '../server/reader-http.mjs';
import { openContentReader } from '../server/content-reader.mjs';
import { createWechatShare, wechatShareConfig } from '../server/wechat-share.mjs';
import { shareMaterialReader } from '../server/card-share-preview.mjs';

export async function startContentShadow(configFile) {
  const file=realpathSync(configFile), base=dirname(file);
  const config=JSON.parse(readFileSync(file,'utf8'));
  if (config.backend!=='content-shadow' || config.kernelConfig || config.lifecycleSocket || process.env.CONCEPT_LIFECYCLE_SOCKET) {
    throw new Error('请显式选择独立的 content-shadow 配置，影子服务不启用宿主维护入口');
  }
  const origin=new URL(config.publicUrl);
  const host=config.host ?? '127.0.0.1';
  if (!['127.0.0.1','::1'].includes(host) || !isLoopback(origin.hostname)) throw new Error('影子服务须使用回环地址');
  const port=config.port;
  if (!Number.isInteger(port) || port<0 || port>65535) throw new Error('影子端口无效');
  if (!config.agentTokenFile || !config.contentRelease || !config.libraryId) throw new Error('需要影子令牌、内容包目录及已核对的库身份');
  const token=readFileSync(resolve(base,config.agentTokenFile),'utf8').trim();
  const auth=authenticationConfig(config,file);
  if (auth.mode==='required') {
    if (config.auth.databaseFile!=='shadow-auth.sqlite') throw new Error('请选择影子目录内独立的 shadow-auth.sqlite');
    const st=lstatSync(auth.databasePath);
    if (!st.isFile() || st.nlink!==1) throw new Error('影子认证库必须是独立普通文件');
  }
  const directory=realpathSync(resolve(base,config.contentRelease));
  const reader=openContentReader({directory,origin:origin.origin,
    libraryId:config.libraryId,manifestSha256:config.manifestSha256});
  let authStore, server;
  try {
    authStore=openServiceAuth(auth);
    const materials=config.shareMaterialsDirectory ? realpathSync(resolve(base,config.shareMaterialsDirectory)) : resolve(directory,'share-materials');
    if (config.shareMaterialsDirectory) JSON.parse(readFileSync(resolve(materials,'catalog.json'),'utf8'));
    server=createReaderApp({contentReader:reader,publicUrl:origin.origin,agentToken:token,authMode:auth.mode,authStore,
      trustedProxyAddress:auth.trustedProxyAddress,requireUIAssets:true,
      wechatShare:createWechatShare(wechatShareConfig(config.wechatShare,file)),
      getShareMaterial:shareMaterialReader(pathToFileURL(materials+sep))});
    await new Promise((yes,no)=>{server.once('error',no);server.listen(port,host,yes);});
  } catch(error) {
    authStore?.close();reader.close();throw error;
  }
  server.once('close',()=>{authStore?.close();reader.close();});
  return server;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href===import.meta.url) {
  const [file,...extra]=process.argv.slice(2);
  if (!file || file==='--help' || extra.length) {
    console.log('npm run start:shadow -- <独立影子配置.json>');
    if (file!=='--help' || extra.length) process.exitCode=1;
  } else {
    const server=await startContentShadow(file);
    console.log('SQLite 影子服务已监听回环端口 '+server.address().port);
    for (const sig of ['SIGTERM','SIGINT']) process.once(sig,()=>server.close());
  }
}
