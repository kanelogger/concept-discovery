#!/usr/bin/env node
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { handoffContentAuth } from '../lib/content-auth-handoff.mjs';

const usage = `node scripts/content-auth-admin.mjs <bind|reconcile|restore> --offline
  --database <已停写的私有 auth.sqlite> --library-id <同库身份> --release <发布目录>
  --manifest-sha256 <核准内容摘要> --control <冷备外控制目录> --checkpoint-sha256 <核准闭门检查点摘要>
  首次 bind 另需 --source-sha256 <站主核实同库及停写后取得的认证库摘要>。
  reconcile 清理已确认永久删除的分享。restore 撤销冷备所有会话和分享、清理永久删除并轮换世代。`;

export function contentAuthCommand(argv) {
  const {positionals,values} = parseArgs({args:argv,allowPositionals:true,options:{
    help:{type:'boolean'},offline:{type:'boolean'},database:{type:'string'},release:{type:'string'},
    control:{type:'string'},'library-id':{type:'string'},'source-sha256':{type:'string'},
    'manifest-sha256':{type:'string'},'checkpoint-sha256':{type:'string'},
  }});
  if (values.help) return usage;
  const [action] = positionals;
  if (positionals.length !== 1 || !['bind','reconcile','restore'].includes(action)) throw new Error(usage);
  const required = ['database','release','control','library-id','manifest-sha256','checkpoint-sha256','offline'];
  if (action === 'bind') required.push('source-sha256');
  else if (values['source-sha256']) throw new Error('仅首次绑定接受旧认证库来源摘要');
  for (const key of required) if (!values[key]) throw new Error('缺少 --'+key);
  const authIdentity = handoffContentAuth(action,{
    databasePath:resolve(values.database),directory:resolve(values.release),libraryId:values['library-id'],
    controlDirectory:resolve(values.control),checkpointSha256:values['checkpoint-sha256'],
    manifestSha256:values['manifest-sha256'],sourceSha256:values['source-sha256'],offline:values.offline,
  });
  return JSON.stringify({libraryId:values['library-id'],authIdentity});
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try { console.log(contentAuthCommand(process.argv.slice(2))); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
