import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { config } from '../lib/siyuan.mjs';
import { createApp } from './app.mjs';
import { loadModelConfig } from './model.mjs';
import { createModelSettings } from './model-settings.mjs';

export function loadServiceConfig(path) {
  const file=resolve(path); const base=dirname(file);
  const c=JSON.parse(readFileSync(file,'utf8'));
  const secret=(p)=>readFileSync(resolve(base,p),'utf8').trim();
  return {
    ...c,
    kernelConfig:config(resolve(base,c.kernelConfig)),
    agentToken:secret(c.agentTokenFile),
    accessCode:secret(c.accessCodeFile),
    modelSettings:createModelSettings(resolve(base,"model-settings.json"),loadModelConfig(c.llm,secret)),
  };
}
export async function start(path=process.env.CONCEPT_SERVICE_CONFIG) {
  if (!path) throw new Error('Set CONCEPT_SERVICE_CONFIG');
  const c=loadServiceConfig(path);
  const server=createApp(c);
  await new Promise((ok,no)=>{server.once('error',no);server.listen(c.port ?? 3000,c.host ?? '127.0.0.1',ok);});
  console.log('Concept Discovery listening on '+(c.host ?? '127.0.0.1')+':'+server.address().port);
  for(const sig of ['SIGTERM','SIGINT'])process.once(sig,()=>server.close(()=>process.exit(0)));
  return server;
}
if(process.argv[1] && import.meta.url===pathToFileURL(resolve(process.argv[1])).href) await start();
