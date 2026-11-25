import assert from 'node:assert/strict';
import { execFileSync, execFile, spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { setTimeout as wait } from 'node:timers/promises';
import { createApp } from '../../server/app.mjs';
import { config, initializeLibrary, Siyuan } from '../../lib/siyuan.mjs';
import { repositoryRoot, writeJSON } from '../../scripts/test-runtime.mjs';
import { acceptanceDirectory } from './runtime.mjs';

async function openLoopback(server) {
  server.listen(0,'127.0.0.1');
  await once(server,'listening');
  return server.address().port;
}

async function stopKernel(child) {
  if (!child?.pid || child.exitCode!==null || child.signalCode!==null) return;
  const exited = once(child,'exit');
  child.kill('SIGTERM');
  const timer=setTimeout(()=>child.kill('SIGKILL'),5000);
  try { await exited; } finally { clearTimeout(timer); }
}

/** Optional macOS fixture for real kernel behavior while Docker is unavailable. */
export async function nativeLifecycleRuntime(label,{initialize,kernelPort}={}) {
  const executable = process.env.CONCEPT_SIYUAN_KERNEL;
  if (process.platform!=='darwin' || !isAbsolute(executable ?? '')) throw new Error('CONCEPT_SIYUAN_KERNEL 须为已核验的 macOS 内核绝对路径。');
  const name='cd-native-'+randomBytes(5).toString('hex');
  const dir=mkdtempSync(join(tmpdir(),name+'-')), root=join(dir,'private'), home=join(dir,'home');
  const evidenceDir=join(acceptanceDirectory,name);
  const evidencePath=join(evidenceDir,'run.json');
  mkdirSync(evidenceDir,{recursive:true,mode:0o700});
  const evidence={runId:name,label,runtime:'native-macos',startedAt:new Date().toISOString(),records:[]};
  let child, server, agentToken, url, finished=false, logs='';
  const record=(step,data)=>{evidence.records.push({step,...data});writeJSON(evidencePath,evidence);};
  const kernelConfig=join(root,'kernel.json');
  async function stop() {
    if (server?.listening) {
      const completion=new Promise(resolve=>server.close(resolve));
      server.closeAllConnections();
      await completion;
    }
    await stopKernel(child);
    server=undefined;
    child=undefined;
  }
  async function start() {
    logs='';
    const settings = config(kernelConfig);
    const api=new Siyuan(settings);
    let launchError;
    child=spawn(executable,['serve','--home-dir',home,'--workspace',join(root,'workspace'),
      '--port',String(kernelPort),'--safe-mode'],{cwd:dir,stdio:['ignore','pipe','pipe']});
    child.once('error',error=>{launchError=error;});
    for (const stream of [child.stdout,child.stderr]) stream.on('data',chunk=>{logs=(logs+chunk).slice(-4000);});
    for (let attempt=0;attempt<100;attempt++) {
      if (launchError) throw launchError;
      if (child.exitCode!==null || child.signalCode!==null) throw new Error('隔离思源进程退出。');
      let ready=false;
      try { ready=(await api.api('/api/system/bootProgress',{},{signal:AbortSignal.timeout(500)})).progress===100; } catch {}
      if (ready) break;
      if (attempt===99) throw new Error('隔离思源未就绪。');
      await wait(100);
    }
    assert.match(logs,/http server \[127\.0\.0\.1:/,'隔离思源监听地址不是回环。');
    const version=await api.api('/api/system/version');
    assert.equal(typeof version==='string'?version:version.version,'3.8.9');
    if (!settings.notebookId) await initializeLibrary(api,kernelConfig);
    const socket = createServer();
    const port=await openLoopback(socket);
    await new Promise(resolve=>socket.close(resolve));
    url='http://127.0.0.1:'+port;
    server=createApp({kernelConfig:config(kernelConfig),agentToken,publicUrl:url,authMode:'local'});
    await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve);});
  }
  async function finish(passed) {
    if (finished) return;
    finished=true;
    await stop();
    rmSync(dir,{recursive:true,force:true});
    writeJSON(evidencePath,{...evidence,result:passed?'passed':'failed',cleaned:true,completedAt:new Date().toISOString()});
    console.log('EVIDENCE '+evidencePath);
  }
  try {
    mkdirSync(home,{mode:0o700});
    if (initialize) await initialize(root);
    else execFileSync(process.execPath,[join(repositoryRoot,'scripts/deploy-init.mjs'),root],{stdio:'pipe'});
    if (!kernelPort) {
      const socket=createServer();
      kernelPort=await openLoopback(socket);
      await new Promise(resolve=>socket.close(resolve));
    }
    const settings = JSON.parse(readFileSync(kernelConfig,'utf8'));
    writeJSON(kernelConfig,{...settings,dataDir:'operations',url:'http://127.0.0.1:'+kernelPort});
    assert.equal(config(kernelConfig).dataDir,join(root,'operations'));
    const configPath = join(root,'workspace/conf/conf.json');
    const kernelProfile = JSON.parse(readFileSync(configPath,'utf8'));
    writeJSON(configPath,{...kernelProfile,system:{...kernelProfile.system,networkServe:false}});
    agentToken=readFileSync(join(root,'agent-token'),'utf8').trim();
    await start();
    record('native-kernel',{version:'3.8.9',loopback:true,isolatedHome:true});
  } catch(error) {
    await finish(false);
    throw error;
  }
  return {
    dir,root,name,kernelPort,record,finish,stop,
    get url() { return url; },
    async restart() { await stop(); await start(); },
    core(script,input={}) {
      return new Promise((resolve,reject)=>{
        const code=`import{readFileSync}from'node:fs';import{config,Siyuan}from'./lib/siyuan.mjs';
          const {kernelConfig,input}=JSON.parse(readFileSync(0,'utf8'));const api=new Siyuan(config(kernelConfig));`+script;
        const processRunner=execFile(process.execPath,['--input-type=module','-e',code],{cwd:repositoryRoot,timeout:30000},
          (error,stdout)=>{if(error)reject(error);else {try{resolve(JSON.parse(stdout));}catch(failure){reject(failure);}}});
        processRunner.stdin.end(JSON.stringify({kernelConfig,input}));
      });
    },
    async call(command,input) {
      const response=await fetch(url+'/api/v1/commands/'+command,{
        method:'POST',headers:{authorization:'Bearer '+agentToken,'content-type':'application/json'},body:JSON.stringify(input),
      });
      const result=await response.json();
      if (!result.ok) throw Object.assign(new Error(result.error.message),{code:result.error.code});
      return result.data;
    },
  };
}
