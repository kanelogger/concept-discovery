import { readFileSync } from 'node:fs';
import { dirname,resolve } from 'node:path';
import { assertReadCommand } from './read-commands.mjs';
export { commands } from './read-commands.mjs';
const failure=(code,message)=>Object.assign(new Error(message),{code});
export function clientConfig(path=process.env.CONCEPT_DISCOVERY_CONFIG){
  if(!path)throw failure('configuration','Set CONCEPT_DISCOVERY_CONFIG to the application client configuration');
  const file=resolve(path),c=JSON.parse(readFileSync(file,'utf8'));
  if(c.notebookId||c.libraryRootId||c.internal)throw failure('configuration','Use the application client configuration; kernel configuration is for local maintenance');
  const u=new URL(c.url);
  if(u.username||u.password||u.search||u.hash||u.pathname!=='/' || (u.protocol!=='https:'&&!(u.protocol==='http:'&&['127.0.0.1','localhost','[::1]'].includes(u.hostname))))throw failure('configuration','Use an HTTPS origin or local loopback origin without credentials');
  const token=c.tokenFile?readFileSync(resolve(dirname(file),c.tokenFile),'utf8').trim():process.env[c.tokenEnv??'CONCEPT_AGENT_TOKEN'];
  if(!token)throw failure('configuration','Application Agent token missing');
  return {url:u.origin,token};
}
export async function runCommand(command,input,c){
  assertReadCommand(command);
  c ??= clientConfig();
  let response,payload;
  try{
    response=await fetch(c.url+'/api/v1/commands/'+command,{method:'POST',redirect:'error',signal:AbortSignal.timeout(30000),headers:{Authorization:'Bearer '+c.token,'Content-Type':'application/json'},body:JSON.stringify(input)});
    payload=await response.json();
  }catch{throw failure('transport_unknown','读取失败，请检查知识库连接后重试。');}
  if(!response.ok||!payload.ok)throw failure(payload.error?.code??'service_error',String(payload.error?.message??'Application request failed').replaceAll(c.token,'[redacted]'));
  return payload.data;
}
