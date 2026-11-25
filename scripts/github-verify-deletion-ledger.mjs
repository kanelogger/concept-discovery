import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { githubInstallationToken } from './github-app-installation.mjs';
import { requireGithubLedgerRemote } from './github-deletion-ledger-gate.mjs';
import { verifyDeletionLedgerAppend } from './verify-deletion-ledger-append.mjs';

const env = process.env;
const candidate = env.LEDGER_CANDIDATE;
const prefix = env.LEDGER_CANDIDATE_PREFIX;
const repository = env.GITHUB_REPOSITORY;
const context = env.LEDGER_CHECK_CONTEXT;
const branches = new Map([
  ['ledger-candidates/production',env.LEDGER_PRODUCTION_BRANCH],
  ['ledger-candidates/drill',env.LEDGER_DRILL_BRANCH],
]);
const branch = branches.get(prefix);
if (!/^[a-f0-9]{40}$/.test(candidate ?? '') || !branch || [...branches.values()].includes('main') ||
    new Set(branches.values()).size !== branches.size || [...branches.values()].some(value=>!value) ||
    !context || !env.LEDGER_ALLOWED_SIGNERS || !env.LEDGER_VERIFIER_KEY)
  throw new Error('独立校验的候选、公钥或账本命名空间配置无效。');

const cwd = process.cwd();
const remote = 'origin';
requireGithubLedgerRemote(cwd,remote,repository);
const directory = mkdtempSync(join(tmpdir(),'cd-ledger-verifier-'));
try {
  const allowedSignersFile = join(directory,'allowed-signers');
  const privateKeyFile = join(directory,'github-app.pem');
  writeFileSync(allowedSignersFile,env.LEDGER_ALLOWED_SIGNERS+'\n',{mode:0o600});
  let verified;
  try { verified = verifyDeletionLedgerAppend({cwd,remote,branch,prefix,candidate,allowedSignersFile,requireTrustedParent:true}); }
  catch (error) {
    if (error.code !== 'ledger_changed') throw error;
  }
  writeFileSync(privateKeyFile,env.LEDGER_VERIFIER_KEY,{mode:0o600});
  const token = await githubInstallationToken({privateKeyFile,repository,
    appId:Number(env.LEDGER_VERIFIER_APP_ID),installationId:Number(env.LEDGER_VERIFIER_INSTALLATION_ID)},'verifier');
  const response = await fetch(`https://api.github.com/repos/${repository}/check-runs`,{
    method:'POST',redirect:'error',signal:AbortSignal.timeout(10000),
    headers:{Accept:'application/vnd.github+json',Authorization:'Bearer '+token,'Content-Type':'application/json'},
    body:JSON.stringify({name:context,head_sha:candidate,status:'completed',conclusion:verified?'success':'failure',
      output:verified ? {title:'账本单条追加已核实',summary:'候选签名、当前父提交和决定结构均已核实。'}
        : {title:'账本候选已拒绝',summary:'签名或决定结构不符合独立验证要求。'}}),
  });
  if (!response.ok) throw new Error('GitHub 未接受独立账本校验结果。');
  if (!verified) throw new Error('独立账本校验已拒绝候选。');
  console.log(JSON.stringify(verified));
} finally { rmSync(directory,{recursive:true,force:true}); }
