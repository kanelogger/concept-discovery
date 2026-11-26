// Runs in the network namespace of the inspected application, with /state read-only.
import { lookup } from 'node:dns/promises';
import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import { request } from 'node:http';
import { isIP } from 'node:net';
import { isAbsolute, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { assertReadCommand } from '../lib/read-commands.mjs';
import { rawInventory } from '../lib/raw-inventory.mjs';
import { Siyuan } from '../lib/siyuan.mjs';
import { observeFrozenArchives } from './frozen-archives.mjs';

const root = '/state';
function requireCopy(ok) {
  if (!ok) throw new Error('冻结副本的配置或读取目标不符');
}
function privateFile(name) {
  requireCopy(typeof name === 'string' && name && !isAbsolute(name));
  const path = resolve(root, name);
  requireCopy(path.startsWith(root + '/') && realpathSync(path) === path && lstatSync(path).isFile());
  return path;
}
function checkedAddress(address) {
  const family = isIP(address);
  requireCopy(family && !address.includes('%'));
  return family === 4 ? address : new URL('http://[' + address + ']').hostname.slice(1, -1);
}
function post(hostname, port, path, headers, body) {
  return new Promise((yes, no) => {
    // Literal addresses, direct sockets and no redirects keep both credentials
    // within their inspected endpoints even if proxy environment variables exist.
    const req = request({ hostname, port, path, method: 'POST', agent: false,
      signal: AbortSignal.timeout(30000), headers: { ...headers, 'Content-Type': 'application/json' } },
    async res => {
      try {
        if (res.statusCode !== 200) {
          res.resume();
          throw Object.assign(new Error('冻结副本拒绝读取'), { statusCode: res.statusCode });
        }
        const chunks = [];
        for await (const chunk of res) chunks.push(chunk);
        yes(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch (error) { no(error); }
    });
    req.on('error', no);
    req.end(JSON.stringify(body));
  });
}

async function run() {
  const kernelIP = checkedAddress(process.argv[2]);
  const origin = new URL(process.argv[3]);
  requireCopy(process.argv[3] === origin.origin && origin.protocol === 'http:' &&
    ['127.0.0.1', '[::1]'].includes(origin.hostname));
  async function checkNetwork() {
    const addresses = await lookup('kernel', { all: true });
    requireCopy(addresses.length && addresses.every(({ address }) => checkedAddress(address) === kernelIP));
  }
  await checkNetwork();
  const settings = JSON.parse(readFileSync(privateFile('kernel.json'), 'utf8'));
  const service = JSON.parse(readFileSync(privateFile('service.json'), 'utf8'));
  const client = JSON.parse(readFileSync(privateFile('client.json'), 'utf8'));
  requireCopy(service.publicUrl === origin.origin && client.url === origin.origin &&
    service.kernelConfig === 'kernel.json' && (service.port ?? 3000) === 3000 &&
    client.tokenFile === service.agentTokenFile && settings.url === 'http://kernel:6806' && settings.internal === true &&
    (service.wikiRoot === undefined || service.wikiRoot === '/state/wiki'));
  const dataDir = resolve(root, settings.dataDir ?? 'operations');
  requireCopy(dataDir === '/state/operations' && realpathSync(dataDir) === dataDir);
  const assets = '/state/workspace/data/assets';
  requireCopy(realpathSync(assets) === assets && lstatSync(assets).isDirectory());
  const kernelFile = privateFile(settings.tokenFile), agentFile = privateFile(service.agentTokenFile);
  requireCopy(kernelFile !== agentFile);
  const kernelToken = readFileSync(kernelFile, 'utf8').trim(), agentToken = readFileSync(agentFile, 'utf8').trim();
  requireCopy(kernelToken && agentToken && kernelToken !== agentToken);

  // Keep the configured logical origin for library identity and historical wiki
  // keys. Only the socket destination changes for these native inventory reads.
  class FrozenKernel extends Siyuan {
    async api(path, body = {}) {
      const payload = await post(kernelIP, 6806, path, { Authorization: 'Token ' + kernelToken }, body);
      requireCopy(payload.code === 0);
      return payload.data;
    }
  }
  const api = new FrozenKernel({ ...settings, dataDir, token: kernelToken });
  for await (const line of createInterface({ input: process.stdin, crlfDelay: Infinity })) {
    try {
      const { method, input } = JSON.parse(line);
      await checkNetwork();
      let data;
      if (method === 'inventory' && input?.withBlocks === true) {
        data = await rawInventory(api, { withBlocks: true });
      } else if (method === 'archive-inventory') {
        data = await observeFrozenArchives(api, input);
      } else if (method === 'public-read') {
        assertReadCommand(input.command);
        const payload = await post('127.0.0.1', 3000, '/api/v1/commands/' + input.command,
          { Host: origin.host, Authorization: 'Bearer ' + agentToken }, input.input);
        requireCopy(payload.ok === true);
        data = payload.data;
      } else throw new Error('不支持的冻结读取请求');
      process.stdout.write(JSON.stringify({ ok: true, data }) + '\n');
    } catch (error) {
      // Never expose response text, request data, private paths or credentials.
      const diagnostic = Number.isInteger(error.statusCode) ? 'http_' + error.statusCode :
        ['ECONNRESET', 'ETIMEDOUT', 'ECONNREFUSED', 'ABORT_ERR', 'EAI_AGAIN'].includes(error.code) ? error.code : 'invalid_read';
      process.stdout.write(JSON.stringify({ ok: false, error: { code: 'freeze_read_failed', message: diagnostic } }) + '\n');
    }
  }
}

try { await run(); }
catch { process.stderr.write('无法初始化冻结副本读取进程。\n'); process.exitCode = 1; }
