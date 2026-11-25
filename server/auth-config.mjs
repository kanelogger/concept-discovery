import { isIP } from 'node:net';
import { basename, dirname, resolve } from 'node:path';

export function isLoopback(hostname) {
  return ['127.0.0.1', 'localhost', '[::1]'].includes(hostname);
}

export function authenticationMode(publicOrigin, mode) {
  if (mode === 'local' && isLoopback(publicOrigin.hostname) && ['http:', 'https:'].includes(publicOrigin.protocol)) return mode;
  if (mode === 'required' && publicOrigin.protocol === 'https:') return mode;
  throw new Error('Configure auth.mode as required with HTTPS, or local with a loopback origin');
}

export function authenticationConfig(service, configPath) {
  const publicOrigin = new URL(service.publicUrl);
  if (publicOrigin.href !== `${publicOrigin.origin}/`) throw new Error('publicUrl must be an origin');
  const { auth } = service;
  const mode = authenticationMode(publicOrigin, auth?.mode ?? 'required');
  if (mode === 'local') return { mode };
  const base = dirname(resolve(configPath));
  const filename = auth?.databaseFile;
  if (typeof filename !== 'string' || filename === '.' || filename === '..' || !filename || basename(filename) !== filename || /[\\\x00-\x1f]/.test(filename)) {
    throw new Error('Configure auth.databaseFile as a private filename beside service.json');
  }
  const databasePath = resolve(base, filename);
  if (databasePath === resolve(configPath)) throw new Error('Auth database and service config must use different files');
  if (auth.trustedProxyAddress !== undefined && !isIP(auth.trustedProxyAddress)) throw new Error('Auth proxy address must be a single IP address');
  return { mode, databasePath, trustedProxyAddress: auth.trustedProxyAddress };
}
