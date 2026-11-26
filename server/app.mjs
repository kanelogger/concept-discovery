import { createServer } from 'node:http';
import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { Siyuan, fail } from '../lib/siyuan.mjs';
import { execute } from '../lib/commands.mjs';
import { assertReadCommand, readOnlyReason } from '../lib/read-commands.mjs';
import { CardBodyReader } from '../lib/card-body-reader.mjs';
import { loadUIAssets } from './ui-assets.mjs';
import { executeWiki, headingQuestion, wikiCommands } from '../lib/wiki.mjs';
import { readScenarioAtlas } from '../lib/scenario-atlas.mjs';
import { readKnowledgeGraph } from './knowledge-graph.mjs';
import { renderCardReferences } from './card-references.mjs';
import { authenticationMode } from './auth-config.mjs';
import { isReadingPage, safeReadingTarget, loginLocation, readSession, sessionEndpoint } from './auth-http.mjs';
import { cardShareRoutes, isSharePage, isShareResource } from './card-share-http.mjs';
import { cardLifecycleEndpoint } from './card-lifecycle-http.mjs';
import { defaultCover, getShareMaterial as defaultShareMaterial, shareHead } from './card-share-preview.mjs';

const same=(a,b)=>timingSafeEqual(createHash('sha256').update(a).digest(),createHash('sha256').update(b).digest());
const staticFiles=new Map([['/',['index.html','text/html; charset=utf-8']],['/favicon.svg',['favicon.svg','image/svg+xml']],
  [defaultCover,['share-cover.png','image/png']]]);
async function bytes(req,limit=16*1024*1024){
  const chunks=[];let size=0;
  for await(const chunk of req){size+=chunk.length;if(size>limit)fail('input_too_large','内容超过大小限制');chunks.push(chunk);}
  return Buffer.concat(chunks);
}
async function json(req,limit){
  try{const value=JSON.parse((await bytes(req,limit)).toString('utf8')||'{}');
    if(!value||typeof value!=='object'||Array.isArray(value))fail('invalid_input','需要JSON对象');return value;
  }catch(e){if(e.code)throw e;fail('invalid_input','JSON格式错误');}
}
function send(res,status,value){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(value));}

function revalidate(req, res, etag) {
  res.setHeader('Cache-Control', 'private, no-cache');
  res.setHeader('ETag', etag);
  res.appendHeader('Vary', 'Cookie, Authorization, Origin');
  const condition = req.headers['if-none-match']?.trim();
  if (!condition) return false;
  if (condition !== '*') {
    // Commas inside an opaque tag belong to the tag. GET uses weak comparison.
    const entry = /[ \t]*(?:(?:W\/)?("[\x21\x23-\x7e\x80-\xff]*"))?[ \t]*(,|$)/gy;
    let matched = false;
    while (entry.lastIndex < condition.length) {
      const tag = entry.exec(condition);
      if (!tag) return false;
      if (tag[1] === etag.replace(/^W\//, '')) matched = true;
    }
    if (!matched) return false;
  }
  res.writeHead(304).end();
  return true;
}
export function assetPath(path){
  let decoded;try{decoded=decodeURIComponent(path);}catch{fail('outside_scope','附件路径无效');}
  if(!decoded.startsWith('/assets/') || /[\\\u0000%]/.test(decoded) || decoded.split('/').slice(2).some(x=>!x||x==='.'||x==='..'))fail('outside_scope','附件路径无效');
  return '/data'+decoded;
}
export function createApp({kernelConfig,agentToken,publicUrl,authMode='required',authStore,trustedProxyAddress,api:providedAPI,executeCommand=execute,wikiRoot,scenarioTimeoutMs=30000,graphTimeoutMs=120000,wechatShare,getShareMaterial=defaultShareMaterial,lifecycle,requireLifecycleReadiness=false,
  uiAssetRoot,previousUIAssetRoot=process.env.CONCEPT_PREVIOUS_UI_DIR,requireUIAssets=false,contentReader}){
  if(!agentToken)throw new Error('Agent token is required');
  const api = contentReader ? null : (providedAPI ?? new Siyuan(kernelConfig));
  const cardBodies = api && new CardBodyReader(api);
  function dispatch(command, input, options = {}) {
    if (contentReader) return contentReader.dispatch(command, input, options);
    if (wikiCommands.has(command)) return executeWiki(api, command, input, {...options, wikiRoot, executeCommand});
    return executeCommand(api, command, input, command === 'list' ? {...options, cardBodies} : options);
  }
  const publicOrigin=new URL(publicUrl),origin=publicOrigin.origin;
  if(new URL(publicUrl).href!==origin+'/')throw new Error('publicUrl must be an origin');
  const authRequired=authenticationMode(publicOrigin,authMode)==='required';
  if(authRequired&&!authStore)throw new Error('The required authentication store is missing');
  const ui = loadUIAssets({uiAssetRoot,previousUIAssetRoot,requireUIAssets});
  function readAsset(path, signal = AbortSignal.timeout(30000)) {
    const file = assetPath(path);
    if (contentReader) return contentReader.readAsset(file.slice('/data'.length), signal);
    return fetch(api.origin+'/api/file/getFile',{
      method:'POST',redirect:'error',signal,
      headers:{Authorization:'Token '+api.c.token,'Content-Type':'application/json'},
      body:JSON.stringify({path:file}),
    });
  }
  const share=cardShareRoutes({api,authStore,dispatch,origin,json,readAsset,send,wechatShare,getShareMaterial,
    activeMain:contentReader && (ref => contentReader.activeMain(ref))});
  const tokenAuthenticated=req=>{
    const auth=req.headers.authorization;
    if(auth===undefined)return false;
    if(typeof auth==='string'&&auth.startsWith('Bearer ')&&same(auth.slice(7),agentToken))return true;
    fail('unauthorized','Agent Token 无效');
  };
  const originCheck=req=>{if(req.headers.origin!==origin)fail('forbidden','请求来源无效，请刷新页面后重试');};
  const requestCheck=(req,navigation)=>{
    let host;
    try{host=new URL('http://'+req.headers.host);}catch{fail('forbidden','请求主机无效');}
    if(host.username||host.password||host.pathname!=='/'||host.search||host.hash||host.hostname!==publicOrigin.hostname)fail('forbidden','请求主机无效');
    if(req.headers.origin!==undefined)originCheck(req);
    if(!navigation&&['cross-site','same-site'].includes(req.headers['sec-fetch-site']))fail('forbidden','请求来源无效，请刷新页面后重试');
  };
  function checkContentVisibility() {
    if (!contentReader || !authStore?.shares) return;
    for (const id of authStore.shares.fencedIds()) {
      if (contentReader.activeMain(id)) fail('content_unavailable','内容包仍包含已隐藏的主卡，请核对候选版本。');
    }
  }
  checkContentVisibility();
  const server=createServer(async(req,res)=>{
    const styleNonce=randomBytes(18).toString('base64');
    res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');
    res.setHeader('Referrer-Policy','no-referrer');res.setHeader('X-Frame-Options','DENY');
    res.setHeader('Vary','Sec-Fetch-Dest, Sec-Fetch-Mode, Sec-Fetch-Site');
    res.setHeader('Content-Security-Policy',`default-src 'self'; script-src 'self'; style-src 'self' 'nonce-${styleNonce}'; img-src 'self' https: http: data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'`);
    try{
      const url = new URL(req.url, origin);
      // Preserve raw path segments for both origin-form and absolute-form request targets.
      const rawPath = req.url.split('?', 1)[0].replace(/^https?:\/\/[^/\\?#]+/i, '');
      const uiRequest = rawPath.startsWith('/ui/') || url.pathname.startsWith('/ui/');
      const canonicalUI = rawPath === url.pathname && url.origin === origin && !url.username && !url.password;
      const path = uiRequest && !canonicalUI ? '/ui/' : url.pathname;
      if(requireLifecycleReadiness&&path!=='/api/status'){
        let ready;
        try{ready=(await lifecycle?.ready())?.ready===true;}catch{}
        if(!ready)fail('lifecycle_unavailable','维护账本和线上库尚未完成核对。');
      }
      if(path==='/api/readiness'&&req.method==='GET'){
        if (!requireLifecycleReadiness) fail('lifecycle_unavailable','当前部署未启用维护就绪门禁。');
        send(res,200,{ok:true,data:{ready:true}});return;
      }
      const page=path==='/archives' ? authRequired&&Boolean(lifecycle) : isReadingPage(path);
      const safeMethod=req.method==='GET'||req.method==='HEAD';
      const sharePage=authRequired&&isSharePage(path)&&safeMethod;
      const publicShareRead=safeMethod&&(sharePage||(authRequired&&isShareResource(path))||path===defaultCover);
      const command=/^\/api\/v1\/commands\/([a-z-]+)$/.exec(path)?.[1];
      const commandRequest=Boolean(command&&req.method==='POST');
      const token=(!authRequired||commandRequest)&&tokenAuthenticated(req);
      const navigation=req.method==='GET'&&(page||path==='/login'||path==='/favicon.svg')&&req.headers['sec-fetch-mode']==='navigate'&&req.headers['sec-fetch-dest']==='document';
      requestCheck(req,navigation||publicShareRead);
      if(!authRequired&&path==='/api/session'){
        send(res,404,{ok:false,error:{code:'not_found',message:'页面或操作不存在'}});return;
      }
      if(req.method!=='GET'&&!publicShareRead&&!token)originCheck(req);
      if(authRequired&&await sessionEndpoint({req,res,path,origin,originCheck,json,send,store:authStore,trustedProxyAddress}))return;
      if(authRequired&&lifecycle&&await cardLifecycleEndpoint({req,res,path,authStore,lifecycle,originCheck,json,send,trustedProxyAddress}))return;
      if(authRequired&&await share.handle({req,res,path}))return;
      if(req.method==='GET'&&path==='/login'){
        if(!authRequired||readSession(req,authStore)){
          res.writeHead(302,{Location:authRequired?safeReadingTarget(url.searchParams.get('next'),origin):'/cards'}).end();return;
        }
      }
      const protectedRead=req.method==='GET'&&(page||path==='/api/scenarios'||path==='/api/graph'||path.startsWith('/assets/'));
      if(authRequired&&(protectedRead||commandRequest)&&!token&&!readSession(req,authStore)){
        if(navigation&&page){
          res.writeHead(302,{Location:loginLocation(safeReadingTarget(path+url.search,origin))}).end();return;
        }
        fail('unauthorized','请登录后继续。');
      }
      if(req.method==='GET'&&path.startsWith('/ui/')){
        const asset=ui.read(path.slice(4),req.headers['accept-encoding']);
        if(!asset){send(res,404,{ok:false,error:{code:'not_found',message:'界面资源不存在'}});return;}
        res.appendHeader('Vary','Accept-Encoding, Origin');
        if(!authRequired)res.appendHeader('Vary','Authorization');
        if(asset.status===406){res.writeHead(406).end();return;}
        if(asset.immutable)res.setHeader('Cache-Control','public, max-age=31536000, immutable');
        if(asset.encoding!=='identity')res.setHeader('Content-Encoding',asset.encoding);
        res.setHeader('Content-Length',asset.content.length);
        res.setHeader('Content-Type',asset.type);res.end(asset.content);return;
      }
      if(sharePage){
        res.setHeader('X-Robots-Tag','noindex, nofollow');
        res.setHeader('Content-Security-Policy',`default-src 'self'; script-src 'self'; style-src 'self' 'nonce-${styleNonce}'; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'`);
      }
      if(sharePage||req.method==='GET'&&(page||staticFiles.has(path)||path==='/login')||req.method==='HEAD'&&path===defaultCover){
        const [file,type]=staticFiles.get(path)??staticFiles.get('/');res.setHeader('Content-Type',type);
        const content=readFileSync(new URL('../web/'+file,import.meta.url));
        if(file!=='index.html'){res.end(content);return;}
        const html=content.toString('utf8').replaceAll('__STYLE_NONCE__',styleNonce).replaceAll('__AUTH_MODE__',authMode)
          .replace('<!-- UI_ASSETS -->',ui.entryHTML)
          .replaceAll('__LIFECYCLE__',authRequired&&lifecycle?'enabled':'disabled');
        const preview=sharePage?await share.pagePreview(path):null;
        if(sharePage&&path!=='/share'&&!preview)res.statusCode=404;
        res.end(preview?html.replace('<title>Concept Discovery</title>',()=>shareHead(preview)):html);return;
      }
      if(path==='/api/status'&&req.method==='GET'){
        send(res,200,{ok:true,data:{readOnly:true}});return;
      }
      if((path==='/api/scenarios'||path==='/api/graph')&&req.method==='GET'){
        if(res.destroyed)return;
        const graph=path==='/api/graph';
        if (contentReader) {
          const { body, etag } = await contentReader.readView(graph ? 'graph' : 'scenarios');
          if (authRequired && !readSession(req,authStore)) fail('unauthorized','请登录后继续。');
          checkContentVisibility();
          if (!revalidate(req, res, etag)) {
            res.setHeader('Content-Type', 'application/json; charset=utf-8');
            res.end(body);
          }
          return;
        }
        const disconnect=new AbortController();
        const timeout=AbortSignal.timeout(graph?graphTimeoutMs:scenarioTimeoutMs);
        const close=()=>disconnect.abort();
        res.once('close',close);
        try{
          const options = { origin, signal: AbortSignal.any([disconnect.signal, timeout]) };
          const data = graph ? await readKnowledgeGraph(api, { ...options, cardBodies }) : await readScenarioAtlas(api, options);
          if(!res.destroyed)send(res,200,{ok:true,data});
        }catch(error){
          if(res.destroyed)return;
          if(!timeout.aborted)throw error;
          send(res,504,{ok:false,error:graph?{code:'graph_timeout',message:'图谱读取超时，请稍后重试。'}:{code:'scenario_timeout',message:'图鉴读取超时，请稍后重试。'}});
        }finally{
          res.off('close',close);
        }
        return;
      }
      if(commandRequest){
        assertReadCommand(command);
        checkContentVisibility();
        const input = await json(req);
        if (res.destroyed) return;
        const disconnect = new AbortController();
        const close = () => disconnect.abort();
        res.once('close', close);
        let data;
        try { data=await dispatch(command,input,{publicUrl:origin,signal:disconnect.signal}); }
        finally { res.off('close',close); }
        if(res.destroyed)return;
        if(command==='get-document'){
          if (!contentReader) {
            const {html}=renderCardReferences(data.markdown,{origin,id:data.id,legacyFixedFields:data.legacyFixedFields,blocks:data.editable?data.blocks:undefined});
            data={...data,html,question:headingQuestion(data.markdown)};
          }
          const shareable = authRequired && !token && (contentReader
            ? (await share.cardInfo(input.id))?.id === data.id
            : data.deletable === true);
          if (contentReader && authRequired && !token && !readSession(req,authStore)) fail('unauthorized','请登录后继续。');
          data={...data,editable:false,deletable:false,readOnlyReason,
            ...(shareable&&{shareable:true}),...(shareable&&!contentReader&&lifecycle&&{canArchive:true})};
        }
        checkContentVisibility();
        send(res,200,{ok:true,data});return;
      }
      if(path.startsWith('/assets/')&&req.method==='GET'){
        checkContentVisibility();
        const r=await readAsset(path);
        if(!r.ok){send(res,404,{ok:false,error:{code:'not_found',message:'附件不存在'}});return;}
        if (contentReader && authRequired && !readSession(req,authStore)) {
          await r.body?.cancel();
          fail('unauthorized','请登录后继续。');
        }
        const type=r.headers.get('content-type')??'application/octet-stream';
        res.setHeader('Content-Type',type);res.setHeader('Content-Security-Policy',"default-src 'none'; sandbox");
        if(!/^image\/(?:png|jpeg|gif|webp|avif|svg\+xml)/.test(type))res.setHeader('Content-Disposition','attachment');
        checkContentVisibility();
        const etag = contentReader && r.headers.get('etag');
        if (etag && /^\/assets\/[0-9a-f]{64}\.[a-z0-9]+$/.test(rawPath) && /^image\//.test(type) &&
            revalidate(req, res, etag)) {
          await r.body?.cancel();
          return;
        }
        res.end(Buffer.from(await r.arrayBuffer()));return;
      }
      send(res,404,{ok:false,error:{code:'not_found',message:'页面或操作不存在'}});
    }catch(error){
      if(res.destroyed)return;
      if(res.headersSent){res.destroy();return;}
      let message=String(error.message??'操作失败');
      for(const secret of [agentToken,api?.c?.token])if(secret)message=message.replaceAll(secret,'[redacted]');
      res.setHeader('Cache-Control','no-store');
      res.removeHeader('ETag');
      const code=error.code??'error';
      const status=code==='unauthorized'||code==='invalid_credentials'?401:code==='rate_limited'?429:code.endsWith('_unavailable')?503:code==='forbidden'?403:/conflict|locked|pending/.test(code)?409:/outside_scope/.test(code)?403:code==='input_too_large'?413:code==='invalid_command'||code==='not_found'?404:code==='unsupported_structure'||code.startsWith('invalid')?400:500;
      if(status===429&&Number.isFinite(error.retryAfter))res.setHeader('Retry-After',String(Math.max(1,Math.ceil(error.retryAfter))));
      send(res,status,{ok:false,error:{code,message}});
    }
  });
  return server;
}
