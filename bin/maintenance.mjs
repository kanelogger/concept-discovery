#!/usr/bin/env node
// Local administrator entry: never exposed by the application HTTP dispatcher.
import { readFileSync } from 'node:fs';
import { config,Siyuan,save,fail } from '../lib/siyuan.mjs';
import { Knowledge } from '../lib/knowledge.mjs';
import { exportLibrary,migrate } from '../lib/migration.mjs';
try{
  const command=process.argv.slice(2).join(' ');
  if(!command||command==='--help')console.log('maintenance <init|migrate export|migrate import|migrate verify>\nLocal administrative configuration only; JSON stdin.');
  else{
    const raw=readFileSync(0,'utf8');if(Buffer.byteLength(raw)>16*1024*1024)fail('invalid_input','Input too large');
    const input=raw.trim()?JSON.parse(raw):{};let result;
    if(command==='migrate export')result=exportLibrary(input.source,input.destination);
    else{
      const c=config(),a=new Siyuan(c),k=new Knowledge(a);
      if(command==='init'){
        result=await a.initialize(input.name);const {token,...rest}=c;
        save(process.env.CONCEPT_DISCOVERY_CONFIG,{...rest,...result});
      }else if(command==='migrate import'||command==='migrate verify')result=await migrate(k,input.directory,command==='migrate verify');
      else fail('invalid_command','Unsupported maintenance command');
    }
    console.log(JSON.stringify({ok:true,data:result}));
  }
}catch(e){console.error(JSON.stringify({ok:false,error:{code:e.code??'error',message:e.message}}));process.exitCode=1;}
