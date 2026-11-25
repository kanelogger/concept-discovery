import { execFileSync, spawn } from 'node:child_process';
import { realpathSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline';
import { once } from 'node:events';

const repo = fileURLToPath(new URL('../', import.meta.url));
function docker(args) {
  return execFileSync('docker', args, { encoding: 'utf8', timeout: 30000, stdio: ['ignore','pipe','pipe'] }).trim();
}
function mountDirectory(container, destination) {
  const mount = container.Mounts.find(m => m.Destination === destination && m.Type === 'bind');
  if (!mount) throw new Error('目标实例缺少挂载 ' + destination);
  return realpathSync(mount.Source);
}
export function managedReceiptLockPath(dataDir = 'operations') {
  const path = resolve('/state',dataDir);
  const dataPath = relative('/state',path);
  if (!dataPath || dataPath.startsWith('..') || dataPath.startsWith('/'))
    throw new Error('受管内核回执目录必须在目标卷内。');
  return join(path,'managed-rpc.lock');
}
export function connectRaw(privateRoot, {lifecycleWorker = false, materialsRoot, socketDir} = {}) {
  const root = realpathSync(privateRoot);
  const service = JSON.parse(readFileSync(join(root,'service.json'),'utf8'));
  if (service.lifecycleSocket && !lifecycleWorker)
    throw new Error('目标库启用了站主管理维护服务，请通过受管入口操作。');
  const envFile = join(root, 'compose.env');
  const declared = /^COMPOSE_PROJECT_NAME=([a-z0-9][a-z0-9_-]*)\s*$/m.exec(readFileSync(envFile, 'utf8'))?.[1];
  const compose = ['compose', ...(declared ? ['-p',declared] : []), '--env-file',envFile,'-f',join(repo,'deploy/compose.yaml')];
  const ids = ['app','kernel'].map(service => docker([...compose,'ps','-q',service]));
  if (!ids.every(id => /^[a-f0-9]{12,64}$/.test(id))) throw new Error('请先启动所选知识库的应用和内核');
  const [app,kernel] = JSON.parse(docker(['inspect', ...ids]));
  const project = declared ?? app.Config.Labels['com.docker.compose.project'];
  for (const [container, service] of [[app,'app'],[kernel,'kernel']]) {
    const labels = container.Config.Labels;
    if (!container.State.Running || labels['com.docker.compose.project'] !== project ||
        labels['com.docker.compose.service'] !== service) throw new Error('目标 Compose 服务不匹配');
  }
  const lifecycle = app.Config?.Env?.includes('CONCEPT_LIFECYCLE_SOCKET=/lifecycle/worker.sock');
  if (lifecycle && !lifecycleWorker) throw new Error('部署已启用站主管理维护服务，请通过受管入口操作。');
  if (lifecycleWorker) {
    const verifiedMount = (target,source) => source && app.Mounts.some(mount=>mount.Destination === target && mount.RW === false) &&
      mountDirectory(app,target) === realpathSync(source);
    if (!lifecycle || !verifiedMount('/lifecycle',socketDir) || !verifiedMount('/app/server/share-materials',materialsRoot))
      throw new Error('目标应用未挂载已确认的只读维护套接字与分享素材目录。');
  }
  if (mountDirectory(app,'/state') !== root || mountDirectory(kernel,'/siyuan/workspace') !== realpathSync(join(root,'workspace')))
    throw new Error('目标容器挂载与所选知识库不符');
  const networks = Object.keys(app.NetworkSettings.Networks).filter(name =>
    kernel.NetworkSettings.Networks[name]?.Aliases?.includes('kernel'));
  if (networks.length !== 1) throw new Error('无法唯一确定目标内核网络');
  const bind = (source, target, readonly = false) => ['--mount',
    `type=bind,src=${source},dst=${target}${readonly ? ',readonly' : ''}`];
  const args = ['run','--rm','-i','--init','--network',networks[0], '--workdir','/app',
    ...bind(root,'/state'), ...bind(join(repo,'lib'),'/app/lib',true),
    ...bind(join(repo,'scripts/raw-kernel.mjs'),'/app/scripts/raw-kernel.mjs',true)];
  if (app.Config.User) args.push('--user',app.Config.User);
  if (lifecycleWorker) {
    const kernelConfig = JSON.parse(readFileSync(join(root,'kernel.json'),'utf8'));
    args.push('--entrypoint','flock',app.Image,'--exclusive','--timeout','25','--no-fork',
      managedReceiptLockPath(kernelConfig.dataDir),'node','/app/scripts/raw-kernel.mjs','--managed');
  } else args.push('--entrypoint','node',app.Image,'/app/scripts/raw-kernel.mjs');
  const child = spawn('docker', args, { stdio:['pipe','pipe','inherit'] });
  const lines = createInterface({ input:child.stdout, crlfDelay:Infinity })[Symbol.asyncIterator]();
  const ended = new Promise(resolve => {
    child.once('error', error => resolve(error.message));
    child.once('close', (code,signal) => resolve(signal ?? code));
  });
  child.stdin.on('error', () => {});
  let busy = false;
  async function rpc(method, input = {}) {
    if (busy) throw new Error('维护请求必须顺序执行');
    busy = true;
    try {
      const unavailable = () => Object.assign(new Error('内核维护连接已关闭，请核对原操作。'),{code:'lifecycle_transport_closed'});
      if (child.stdin.destroyed) throw unavailable();
      if (!child.stdin.write(JSON.stringify({method,input})+'\n')) {
        await Promise.race([once(child.stdin,'drain'),ended.then(()=>{throw unavailable();})]);
      }
      const line = await lines.next();
      if (line.done) throw unavailable();
      const response = JSON.parse(line.value);
      if (!response.ok) throw Object.assign(new Error(response.error.message),{code:response.error.code});
      return response.data;
    } finally { busy = false; }
  }
  return { root, project, rpc, ended, async close() { child.stdin.end(); await ended; } };
}
