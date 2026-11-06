import { createServer } from 'node:http';
import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { Siyuan, fail } from '../lib/siyuan.mjs';
import { commands as commandNames, execute } from '../lib/commands.mjs';
import { renderMarkdown } from './render.mjs';
import { readUIAsset } from './ui-assets.mjs';
import { askErrors, createAskRunner } from './ask.mjs';
import { chatCompletions } from './model.mjs';

const same=(a,b)=>timingSafeEqual(createHash('sha256').update(a).digest(),createHash('sha256').update(b).digest());
const staticFiles=new Map([['/',['index.html','text/html; charset=utf-8']],['/favicon.svg',['favicon.svg','image/svg+xml']]]);
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
export function assetPath(path){
  let decoded;try{decoded=decodeURIComponent(path);}catch{fail('outside_scope','附件路径无效');}
  if(!decoded.startsWith('/assets/') || /[\\\u0000%]/.test(decoded) || decoded.split('/').slice(2).some(x=>!x||x==='.'||x==='..'))fail('outside_scope','附件路径无效');
  return '/data'+decoded;
}
export function createApp({kernelConfig,agentToken,accessCode,publicUrl,api:providedAPI,executeCommand=execute,llm,modelSettings,modelFetch,askTimeoutMs,logAsk}){
  if(!agentToken||!accessCode)throw new Error('Application credentials are required');
  const api=providedAPI??new Siyuan(kernelConfig);
  const origin=new URL(publicUrl).origin;
  if(new URL(publicUrl).href!==origin+'/')throw new Error('publicUrl must be an origin');
  if(!/^https:/.test(origin)&&!['127.0.0.1','localhost','[::1]'].includes(new URL(origin).hostname))throw new Error('Remote application requires HTTPS');
  const sessions=new Map(),attempts=new Map();
  const analysis=createAskRunner(null,{timeoutMs:askTimeoutMs,log:logAsk});
  const currentModel=()=>modelSettings ? modelSettings.current() : llm;
  const secure=origin.startsWith('https:')?'; Secure':'';
  const cookie=(value,age)=>`cd_session=${value}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${age}${secure}`;
  const sessionId=req=>/(?:^|;\s*)cd_session=([a-f0-9]{64})(?:;|$)/.exec(req.headers.cookie??'')?.[1];
  const authenticated=req=>{
    const auth=req.headers.authorization;
    if(auth?.startsWith('Bearer ')&&same(auth.slice(7),agentToken))return 'token';
    const sid=sessionId(req);
    if(sid&&sessions.get(sid)>Date.now())return 'session';
    if(sid)sessions.delete(sid);return false;
  };
  const originCheck=req=>{if(req.headers.origin!==origin)fail('forbidden','请求来源无效，请刷新页面后重试');};
  const server=createServer(async(req,res)=>{
    const styleNonce=randomBytes(18).toString('base64');
    res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');
    res.setHeader('Referrer-Policy','no-referrer');res.setHeader('X-Frame-Options','DENY');
    res.setHeader('Content-Security-Policy',`default-src 'self'; script-src 'self'; style-src 'self' 'nonce-${styleNonce}'; img-src 'self' https: http: data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'`);
    try{
      const url=new URL(req.url,origin),path=url.pathname;
      if(req.method==='GET'&&path.startsWith('/ui/')){
        const asset=readUIAsset(path.slice(4));
        if(!asset){send(res,404,{ok:false,error:{code:'not_found',message:'界面资源不存在'}});return;}
        res.setHeader('Content-Type',asset.type);res.end(asset.content);return;
      }
      if(req.method==='GET'&&(staticFiles.has(path)||/^\/cards(?:\/[^/]+(?:\/edit)?)?$/.test(path))){
        const [file,type]=staticFiles.get(path)??staticFiles.get('/');res.setHeader('Content-Type',type);
        const content=readFileSync(new URL('../web/'+file,import.meta.url));
        res.end(file==='index.html'?content.toString('utf8').replaceAll('__STYLE_NONCE__',styleNonce):content);return;
      }
      const auth=authenticated(req);
      if(path==='/api/session'){
        if(req.method==='GET'){send(res,200,{ok:true,data:{authenticated:!!auth,askAvailable:!!auth&&Boolean(currentModel())}});return;}
        originCheck(req);
        if(req.method==='POST'){
          const key=req.socket.remoteAddress;const now=Date.now();
          const history=(attempts.get(key)??[]).filter(t=>now-t<60000);attempts.set(key,history);
          if(history.length>=10){send(res,429,{ok:false,error:{code:'rate_limited',message:'尝试过于频繁，请稍后重试'}});return;}
          const input=await json(req);
          if(typeof input.accessCode!=='string'||!same(input.accessCode,accessCode)){history.push(now);send(res,401,{ok:false,error:{code:'unauthorized',message:'访问码不正确'}});return;}
          for(const [key,expires]of sessions)if(expires<now)sessions.delete(key);
          const sid=randomBytes(32).toString('hex');sessions.set(sid,now+86400000);res.setHeader('Set-Cookie',cookie(sid,86400));
          send(res,200,{ok:true,data:{authenticated:true,askAvailable:Boolean(currentModel())}});return;
        }
        if(req.method==='DELETE'){
          const sid=sessionId(req);sessions.delete(sid);analysis.revoke(sid);
          res.setHeader('Set-Cookie',cookie('',0));send(res,200,{ok:true,data:{authenticated:false}});return;
        }
      }
      if(!auth){send(res,401,{ok:false,error:{code:'unauthorized',message:'请先输入访问码'}});return;}
      if(req.method!=='GET'&&auth==='session')originCheck(req);
      if(path==='/api/model-settings'&&modelSettings&&(req.method==='GET'||req.method==='PUT')){
        if(auth!=='session')fail('forbidden','请通过网页会话管理模型设置。');
        const data=req.method==='GET'?modelSettings.view():modelSettings.update(await json(req,16384));
        send(res,200,{ok:true,data});return;
      }
      if(path==='/api/preview'&&req.method==='POST'){
        const input=await json(req);if(typeof input.markdown!=='string')fail('invalid_input','正文必须是文字');
        send(res,200,{ok:true,data:{html:renderMarkdown(input.markdown)}});return;
      }
      const command=/^\/api\/v1\/commands\/([a-z-]+)$/.exec(path)?.[1];
      if(command&&req.method==='POST'){
        if(!commandNames.has(command))fail('invalid_command','此操作未开放');
        if(command==='ask'){
          const input=await json(req,16384);
          const session=auth==='session'?sessionId(req):undefined;
          const expiresAt=sessions.get(session);
          if(session&&!(expiresAt>Date.now()))fail('ask_session_expired',askErrors.ask_session_expired[1]);
          if(res.destroyed)return;
          const disconnect=new AbortController();
          const close=()=>disconnect.abort();
          res.once('close',close);
          try {
            const data=await analysis.run({session,expiresAt,clientSignal:disconnect.signal,model:chatCompletions(currentModel(),modelFetch)},
              options=>executeCommand(api,'ask',input,{...options,publicUrl:origin}));
            if(!res.destroyed)send(res,200,{ok:true,data});
          } finally {
            res.off('close',close);
          }
          return;
        }
        let data=await executeCommand(api,command,await json(req),{publicUrl:origin});
        if(command==='get-document'){
          const html=renderMarkdown(data.markdown,{legacyFixedFields:data.legacyFixedFields,blocks:data.editable?data.blocks:undefined});
          data={...data,html};
        }
        send(res,200,{ok:true,data});return;
      }
      if(path==='/api/assets'&&req.method==='POST'){
        const body=await bytes(req);const form=await new Response(body,{headers:{'content-type':req.headers['content-type']??''}}).formData();
        const files=form.getAll('files[]');
        if(files.length!==1||typeof files[0]==='string')fail('invalid_input','请选择一张图片');
        const file=files[0];
        if(!/^image\/(?:png|jpeg|webp|gif|avif|svg\+xml)$/.test(file.type))fail('invalid_input','仅支持图片上传');
        const upload=new FormData();upload.append('file[]',file,file.name);upload.append('assetsDirPath','/assets/');
        const r=await fetch(api.origin+'/api/asset/upload',{method:'POST',redirect:'error',signal:AbortSignal.timeout(30000),headers:{Authorization:'Token '+api.c.token},body:upload});
        const result=await r.json();if(!r.ok||result.code!==0)fail('upload_failed','图片上传失败，请重试');
        const saved=Object.values(result.data?.succMap??{})[0];if(typeof saved!=='string')fail('upload_failed','图片未保存');
        const normalized='/'+saved.replace(/^\/+/, '');assetPath(normalized);
        send(res,200,{ok:true,data:{path:normalized}});return;
      }
      if(path.startsWith('/assets/')&&req.method==='GET'){
        const file=assetPath(path);
        const r=await fetch(api.origin+'/api/file/getFile',{method:'POST',redirect:'error',signal:AbortSignal.timeout(30000),headers:{Authorization:'Token '+api.c.token,'Content-Type':'application/json'},body:JSON.stringify({path:file})});
        if(!r.ok){send(res,404,{ok:false,error:{code:'not_found',message:'附件不存在'}});return;}
        const type=r.headers.get('content-type')??'application/octet-stream';
        res.setHeader('Content-Type',type);res.setHeader('Content-Security-Policy',"default-src 'none'; sandbox");
        if(!/^image\/(?:png|jpeg|gif|webp|avif|svg\+xml)/.test(type))res.setHeader('Content-Disposition','attachment');
        res.end(Buffer.from(await r.arrayBuffer()));return;
      }
      send(res,404,{ok:false,error:{code:'not_found',message:'页面或操作不存在'}});
    }catch(error){
      if(res.destroyed)return;
      if(res.headersSent){res.destroy();return;}
      if(Object.hasOwn(askErrors,error.code)){
        const [status,message]=askErrors[error.code];
        send(res,status,{ok:false,error:{code:error.code,message}});return;
      }
      let message=String(error.message??'操作失败');
      for(const secret of [agentToken,accessCode,api.c?.token])if(secret)message=message.replaceAll(secret,'[redacted]');
      const code=error.code??'error';
      const status=code==='forbidden'?403:/conflict|locked|pending/.test(code)?409:/outside_scope/.test(code)?403:code==='input_too_large'?413:code==='invalid_command'?404:code.startsWith('invalid')?400:500;
      send(res,status,{ok:false,error:{code,message}});
    }
  });
  return server;
}
