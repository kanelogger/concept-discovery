import { execFileSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export function diagnose({ root = process.cwd(), nodeVersion = process.versions.node, run = execFileSync } = {}) {
  const checks = [];
  checks.push({ name: 'Node.js 24', passed: Number(nodeVersion.split('.')[0]) === 24, detail: `v${nodeVersion}` });
  try {
    const version = run('git', ['--version'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
    checks.push({ name: 'Git', passed: true, detail: version });
  } catch {
    checks.push({ name: 'Git', passed: false, detail: 'git is unavailable' });
  }
  try {
    const top = run('git', ['-C', root, 'rev-parse', '--show-toplevel'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
    checks.push({ name: 'Repository root', passed: realpathSync(top) === realpathSync(root), detail: top });
  } catch {
    checks.push({ name: 'Repository root', passed: false, detail: 'Run this command from the Git repository root' });
  }
  return checks;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const checks = diagnose();
  for (const check of checks) console.log(`${check.passed ? 'PASS' : 'FAIL'} ${check.name}: ${check.detail}`);
  process.exitCode = checks.every((check) => check.passed) ? 0 : 1;
}
