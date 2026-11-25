#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { commands, assertReadCommand } from '../lib/read-commands.mjs';
import { runCommand } from '../lib/client.mjs';
try{
  const command=process.argv.slice(2).join(' ');
  if(!command||command==='--help')console.log('concept-discovery <'+commands.join('|')+'>\n只读查询。stdin 输入 JSON，CONCEPT_DISCOVERY_CONFIG 指向应用客户端配置。原稿维护请使用 npm run raw。');
  else{
    assertReadCommand(command);
    const raw=readFileSync(0,'utf8');
    if(Buffer.byteLength(raw)>16*1024*1024)throw Object.assign(new Error('Input too large'),{code:'invalid_input'});
    const input=raw.trim()?JSON.parse(raw):{};
    console.log(JSON.stringify({ok:true,data:await runCommand(command,input)}));
  }
}catch(e){console.error(JSON.stringify({ok:false,error:{code:e.code??'error',message:e.message}}));process.exitCode=1;}
