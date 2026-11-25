import { createSign } from 'node:crypto';
import { lstatSync, readFileSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import { pathToFileURL } from 'node:url';

const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
const validRepository = /^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/;
const validIdentifier = value => Number.isSafeInteger(value) && value > 0;
const rolePermissions = new Map([
  ['reader', {contents:'read'}],
  ['writer', {contents:'write',checks:'read'}],
  ['verifier', {contents:'read',checks:'write'}],
]);

/** Mint a short-lived token restricted to one approved repository and role. */
export async function githubInstallationToken(configuration, role, {fetcher=fetch,now=Date.now}={}) {
  const {appId,installationId,privateKeyFile,repository} = configuration ?? {};
  if (!validIdentifier(appId) || !validIdentifier(installationId) || !validRepository.test(repository ?? '') ||
      typeof privateKeyFile !== 'string' || !isAbsolute(privateKeyFile) || !rolePermissions.has(role))
    throw new Error('GitHub App 安装身份或目标仓库无效。');
  const key = lstatSync(privateKeyFile);
  if (!key.isFile() || (key.mode & 0o077)) throw new Error('GitHub App 签署密钥必须为私有普通文件。');
  const time = Math.floor(now()/1000);
  const unsigned = encode({alg:'RS256',typ:'JWT'})+'.'+encode({iat:time-60,exp:time+540,iss:String(appId)});
  const jwt = unsigned+'.'+createSign('RSA-SHA256').update(unsigned).sign(readFileSync(privateKeyFile),'base64url');
  const permissions = rolePermissions.get(role);
  const response = await fetcher(`https://api.github.com/app/installations/${installationId}/access_tokens`,{
    method:'POST',redirect:'error',signal:AbortSignal.timeout(8000),
    headers:{Accept:'application/vnd.github+json',Authorization:'Bearer '+jwt,'Content-Type':'application/json'},
    body:JSON.stringify({repositories:[repository.split('/')[1]],permissions}),
  });
  if (!response.ok) throw new Error('GitHub 拒绝所需的 App 安装权限。');
  const result = await response.json();
  if (typeof result.token !== 'string' || !/^[a-zA-Z0-9._-]+$/.test(result.token) ||
      !Array.isArray(result.repositories) || result.repositories.length !== 1 ||
      result.repositories[0].full_name !== repository ||
      Object.entries(permissions).some(([key, value])=>result.permissions?.[key] !== value) ||
      Object.entries(result.permissions ?? {}).some(([key,value])=>(key === 'metadata' ? 'read' : permissions[key]) !== value))
    throw new Error('GitHub App 令牌的范围未得到核实。');
  return result.token;
}

async function main([filename,operation,...extra]) {
  if (!filename || !['get','store','erase'].includes(operation) || extra.length)
    throw new Error('需要 GitHub 写入 App 配置和 Git 凭据调用类型。');
  if (operation !== 'get') return;
  const settings = JSON.parse(readFileSync(filename,'utf8'));
  const params = new Map(readFileSync(0,'utf8').split('\n').filter(line=>line.includes('=')).map(line=>{
    const separator = line.indexOf('=');
    return [line.slice(0,separator),line.slice(separator+1)];
  }));
  if (params.get('protocol') !== 'https' || params.get('host') !== 'github.com' ||
      params.get('path')?.replace(/\.git$/,'') !== settings.repository) return;
  const token = await githubInstallationToken(settings,'writer');
  process.stdout.write(`username=x-access-token\npassword=${token}\n\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main(process.argv.slice(2));
