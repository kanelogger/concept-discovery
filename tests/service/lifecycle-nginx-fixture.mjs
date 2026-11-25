import { execFileSync, spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as wait } from 'node:timers/promises';

export async function startLifecycleNginx(upstreamPort) {
  const binary = process.env.CONCEPT_NGINX ?? 'nginx';
  const root = mkdtempSync(join(tmpdir(),'cd-nginx-drill-'));
  let proxy;
  const close = async () => {
    if (proxy?.pid && proxy.exitCode===null && proxy.signalCode===null) {
      const stopped = once(proxy,'exit');
      proxy.kill('SIGTERM');
      await stopped;
    }
    rmSync(root,{recursive:true,force:true});
  };
  try {
    const portCheck = createServer();
    portCheck.listen(0,'127.0.0.1');
    await once(portCheck,'listening');
    const port = portCheck.address().port;
    await new Promise(resolve=>portCheck.close(resolve));
    const gate = readFileSync(new URL('../../deploy/nginx-lifecycle-gate.conf',import.meta.url),'utf8')
      .replace('127.0.0.1:6806',`127.0.0.1:${upstreamPort}`);
    const config = join(root,'nginx.conf');
    writeFileSync(config,`pid "${root}/nginx.pid";
      error_log "${root}/error.log";
      events {}
      http { access_log off;
        client_body_temp_path "${root}";
        proxy_temp_path "${root}";
        server {
          listen 127.0.0.1:${port};
          ${gate}
          location / {
            proxy_pass http://127.0.0.1:${upstreamPort};
            proxy_set_header Host $http_host;
          }
        }
      }`);
    const args = ['-p',root+'/', '-c',config,'-e',join(root,'error.log')];
    execFileSync(binary,[...args,'-t'],{stdio:'pipe'});
    proxy = spawn(binary,[...args,'-g','daemon off;'],{stdio:['ignore','ignore','inherit']});
    let spawnError;
    proxy.once('error',error=>{spawnError=error;});
    const endpoint = `http://127.0.0.1:${port}`;
    for (let attempt=0;attempt<40;attempt++) {
      if (spawnError) throw spawnError;
      try { await fetch(endpoint+'/_concept_discovery_lifecycle_ready'); break; }
      catch (error) { if (attempt===39) throw error; await wait(50); }
    }
    return {port,endpoint,close};
  } catch (error) {
    await close();
    throw error;
  }
}
