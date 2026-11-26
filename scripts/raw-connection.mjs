import { execFileSync, spawn } from 'node:child_process';
import { lstatSync, readdirSync, readlinkSync, realpathSync, readFileSync } from 'node:fs';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { isIP } from 'node:net';
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
function checkFrozenMount(container, destination, source) {
  const overlap = container.Mounts.filter(m => m.Destination === destination ||
    m.Destination.startsWith(destination + '/') || destination.startsWith(m.Destination.replace(/\/$/, '') + '/'));
  if (overlap.length !== 1 || overlap[0].Destination !== destination || overlap[0].Type !== 'bind' ||
      realpathSync(overlap[0].Source) !== source) throw new Error('冻结副本数据挂载重叠或物理来源不符');
}
function checkContainedDirectory(base) {
  if (!lstatSync(base, { throwIfNoEntry: false })) return;
  if (realpathSync(base) !== base || !lstatSync(base).isDirectory()) throw new Error('冻结副本数据目录物理路径不符');
  function walk(path) {
    for (const entry of readdirSync(path, { withFileTypes: true })) {
      const file = join(path, entry.name);
      if (entry.isDirectory()) walk(file);
      if (entry.isSymbolicLink()) {
        const tail = relative(base, realpathSync(file));
        if (isAbsolute(readlinkSync(file)) || isAbsolute(tail) || tail === '..' || tail.startsWith('..' + sep))
          throw new Error('冻结副本数据目录包含越界链接');
      }
    }
  }
  walk(base);
}
function requireLocalDocker() {
  // Mount sources must refer to this machine's inspected physical copy.
  const endpoint = !process.env.DOCKER_CONTEXT && process.env.DOCKER_HOST ||
    docker(['context', 'inspect', '--format', '{{.Endpoints.docker.Host}}', docker(['context', 'show'])]);
  const socket = new URL(endpoint);
  if (socket.protocol !== 'unix:' || socket.host || !isAbsolute(socket.pathname))
    throw new Error('冻结副本需要本机 Docker Unix 套接字');
}
function frozenKernelAddress(app, kernel, network, root, ids) {
  if (![app, kernel].every((container, index) => /^[a-f0-9]{64}$/.test(container.Id) && container.Id.startsWith(ids[index])) ||
      app.Id === kernel.Id || Object.keys(app.NetworkSettings.Networks).length !== 1 ||
      app.HostConfig?.ExtraHosts?.some(line => /^kernel[:=]/i.test(line)) ||
      !app.Config.Env?.includes('CONCEPT_SERVICE_CONFIG=/state/service.json'))
    throw new Error('冻结副本容器身份、网络或应用配置不符');
  checkFrozenMount(app, '/state', root);
  checkFrozenMount(kernel, '/siyuan/workspace', join(root, 'workspace'));
  for (const name of ['workspace', 'wiki', 'raw-sync']) checkContainedDirectory(join(root, name));
  const target = kernel.NetworkSettings.Networks[network];
  if (!/^[a-f0-9]{64}$/.test(target.NetworkID) || app.NetworkSettings.Networks[network].NetworkID !== target.NetworkID)
    throw new Error('冻结副本未共享相同的已核实网络');
  const peers = JSON.parse(docker(['network', 'inspect', '--format', '{{json .Containers}}', target.NetworkID]));
  const address = target.IPAddress || target.GlobalIPv6Address;
  const assigned = isIP(address) === 4 ? peers[kernel.Id]?.IPv4Address : peers[kernel.Id]?.IPv6Address;
  if (Object.keys(peers).length !== 2 || !peers[app.Id] || !isIP(address) || assigned?.split('/')[0] !== address)
    throw new Error('冻结副本网络成员或内核地址不符');
  return address;
}
export function managedReceiptLockPath(dataDir = 'operations') {
  const path = resolve('/state',dataDir);
  const dataPath = relative('/state',path);
  if (!dataPath || dataPath.startsWith('..') || dataPath.startsWith('/'))
    throw new Error('受管内核回执目录必须在目标卷内。');
  return join(path,'managed-rpc.lock');
}
export function connectRaw(privateRoot, {lifecycleWorker = false, materialsRoot, socketDir, frozenReaderOrigin} = {}) {
  const root = realpathSync(privateRoot);
  const service = JSON.parse(readFileSync(join(root,'service.json'),'utf8'));
  if (service.lifecycleSocket && !lifecycleWorker)
    throw new Error('目标库启用了站主管理维护服务，请通过受管入口操作。');
  const envFile = join(root, 'compose.env');
  const frozen = frozenReaderOrigin !== undefined;
  if (frozen) requireLocalDocker();
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
  if (frozen) {
    const url = new URL(frozenReaderOrigin);
    const [binding, ...others] = app.NetworkSettings.Ports?.['3000/tcp'] ?? [];
    const host = binding?.HostIp === '::1' ? '[::1]' : binding?.HostIp;
    if (others.length || !['127.0.0.1','[::1]'].includes(host) || url.protocol !== 'http:' ||
        url.origin !== frozenReaderOrigin || url.hostname !== host || (url.port || '80') !== binding.HostPort)
      throw new Error('冻结读取地址与已核实应用容器的回环端口不符');
  }
  const networks = Object.keys(app.NetworkSettings.Networks).filter(name =>
    kernel.NetworkSettings.Networks[name]?.Aliases?.includes('kernel'));
  if (networks.length !== 1) throw new Error('无法唯一确定目标内核网络');
  const address = frozen && frozenKernelAddress(app, kernel, networks[0], root, ids);
  const script = frozen ? 'frozen-reader.mjs' : 'raw-kernel.mjs';
  const bind = (source, target, readonly = false) => ['--mount',
    `type=bind,src=${source},dst=${target}${readonly ? ',readonly' : ''}`];
  const args = ['run','--rm','-i','--init','--network',frozen ? 'container:' + app.Id : networks[0], '--workdir','/app',
    ...bind(root,'/state',frozen), ...bind(join(repo,'lib'),'/app/lib',true),
    ...bind(join(repo,'scripts',script),'/app/scripts/' + script,true)];
  if (frozen) args.push(...bind(join(repo,'scripts/frozen-archives.mjs'),'/app/scripts/frozen-archives.mjs',true));
  if (app.Config.User) args.push('--user',app.Config.User);
  if (lifecycleWorker) {
    const kernelConfig = JSON.parse(readFileSync(join(root,'kernel.json'),'utf8'));
    args.push('--entrypoint','flock',app.Image,'--exclusive','--timeout','25','--no-fork',
      managedReceiptLockPath(kernelConfig.dataDir),'node','/app/scripts/raw-kernel.mjs','--managed');
  } else args.push('--entrypoint','node',app.Image,'/app/scripts/' + script);
  if (frozen) args.push(address, frozenReaderOrigin);
  // Docker diagnostics can include private mount names. The freeze CLI reports
  // only whether its isolated inventory completed, while maintenance keeps its logs.
  const child = spawn('docker', args, { stdio:['pipe','pipe',frozenReaderOrigin === undefined ? 'inherit' : 'ignore'] });
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
