#!/usr/bin/env node
// Local administrator entry: never exposed by the application HTTP dispatcher.
import { readFileSync } from 'node:fs';
import { config,Siyuan,initializeLibrary,fail } from '../lib/siyuan.mjs';
try{
  const command=process.argv.slice(2).join(' ');
  if(!command||command==='--help')console.log('maintenance <init>\n仅限本地管理配置；stdin输入JSON。');
  else{
    const raw=readFileSync(0,'utf8');if(Buffer.byteLength(raw)>16*1024*1024)fail('invalid_input','Input too large');
    const input=raw.trim()?JSON.parse(raw):{};
    if(command!=='init')fail('invalid_command','此维护命令已下线');
    const c=config(),a=new Siyuan(c);
    const result=await initializeLibrary(a,process.env.CONCEPT_DISCOVERY_CONFIG,input.name);
    console.log(JSON.stringify({ok:true,data:result}));
  }
}catch(e){console.error(JSON.stringify({ok:false,error:{code:e.code??'error',message:e.message}}));process.exitCode=1;}
