#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { commands,runCommand } from '../lib/client.mjs';
try{
  const command=process.argv.slice(2).join(' ');
  if(!command||command==='--help')console.log('concept-discovery <'+commands.join('|')+'>\nJSON stdin; CONCEPT_DISCOVERY_CONFIG points to the application client config.');
  else{
    const raw=readFileSync(0,'utf8');
    if(Buffer.byteLength(raw)>16*1024*1024)throw Object.assign(new Error('Input too large'),{code:'invalid_input'});
    const input=raw.trim()?JSON.parse(raw):{};
    console.log(JSON.stringify({ok:true,data:await runCommand(command,input)}));
  }
}catch(e){console.error(JSON.stringify({ok:false,error:{code:e.code??'error',message:e.message}}));process.exitCode=1;}
