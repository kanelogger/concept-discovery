import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { fail } from '../lib/siyuan.mjs';
import { validateDecision, validateSignedDecision } from './git-deletion-ledger.mjs';
import { requireGithubLedgerRemote } from './github-deletion-ledger-gate.mjs';

export function verifyDeletionLedgerAppend({cwd,remote,branch,prefix,candidate,allowedSignersFile,requireTrustedParent=false,contentDecisions=false}) {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(remote ?? '') || !/^[a-zA-Z0-9][a-zA-Z0-9_/-]*$/.test(branch ?? '') ||
      !/^ledger-candidates\/[a-z0-9-]+$/.test(prefix ?? '') || !/^[a-f0-9]{40}$/.test(candidate ?? '') || !allowedSignersFile)
    fail('invalid_input','校验目标或已知签署者配置无效。');
  const git = (...args)=>execFileSync('git',['--no-replace-objects','-c','gpg.format=ssh','-c','gpg.ssh.allowedSignersFile='+allowedSignersFile,...args],
    {cwd,encoding:'utf8',timeout:30000,stdio:['ignore','pipe','pipe']}).trim();
  const temp='refs/concept-check/'+randomUUID();
  try {
    git('fetch','--no-tags','--no-write-fetch-head','--refmap=',remote,
      'refs/heads/'+branch+':'+temp+'/current',
      'refs/heads/'+prefix+'/'+candidate+':'+temp+'/candidate');
    const parent = git('rev-parse',temp+'/current');
    if (git('rev-parse',temp+'/candidate') !== candidate)
      fail('ledger_conflict','候选须直接追加到当前权威账本。');
    const decision = readLedgerAppend(git,parent,candidate,requireTrustedParent,
      contentDecisions ? validateSignedDecision : validateDecision);
    return {candidate,parent,opId:decision.opId};
  } finally {
    git('update-ref','-d',temp+'/current');
    git('update-ref','-d',temp+'/candidate');
  }
}

export function verifyLedgerSignature(git,commit,{authority=false,knownSigner=false}={}) {
  const header = git('cat-file','commit',commit).split('\n\n',1)[0];
  if (!/^gpgsig -----BEGIN SSH SIGNATURE-----$/m.test(header))
    fail(authority ? 'ledger_untrusted' : 'ledger_changed','账本提交没有 SSH 签名。');
  try { git('verify-commit',commit); }
  catch (error) {
    if (!knownSigner || error.status !== 1) throw error;
    fail('ledger_changed','候选签名未获信任。');
  }
}

export function readLedgerAppend(git,parent,candidate,requireTrustedParent=false,validate=validateSignedDecision) {
  if (git('show','-s','--format=%P',candidate) !== parent)
    fail('ledger_conflict','候选须直接追加到当前权威账本。');
  // Verify the known parent first so unavailable SSH tooling or bad trust
  // configuration cannot become a terminal rejection of this candidate.
  if (requireTrustedParent) verifyLedgerSignature(git,parent,{authority:true});
  verifyLedgerSignature(git,candidate,{knownSigner:requireTrustedParent});
  const delta = git('diff-tree','--raw','-r','--no-renames','--no-commit-id',parent,candidate);
  const match = /^:000000 100644 0+ [a-f0-9]+ A\t(decisions\/([a-zA-Z0-9_-]{1,100})\.json)$/.exec(delta);
  if (!match) fail('ledger_changed','候选必须且只能追加一个普通决定文件。');
  const bytes = git('show',candidate+':'+match[1]);
  let decision;
  try { decision = validate(JSON.parse(bytes)); }
  catch (error) {
    if (!(error instanceof SyntaxError) && error.code !== 'invalid_input') throw error;
    fail('ledger_changed','候选决定格式无效。');
  }
  if (decision.opId !== match[2]) fail('ledger_changed','决定文件名与操作 ID 不一致。');
  return decision;
}

function main([filename,candidate,...extra]) {
  if (!filename || !candidate || extra.length)
    throw new Error('用法：node scripts/verify-deletion-ledger-append.mjs <私有校验配置> <候选 SHA>');
  const config = JSON.parse(readFileSync(filename,'utf8'));
  if (!/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/.test(config.repository ?? '') || typeof config.context !== 'string' || !config.context)
    fail('invalid_input','缺少 GitHub 仓库和校验名称。');
  requireGithubLedgerRemote(config.cwd,config.remote,config.repository);
  const verified = verifyDeletionLedgerAppend({...config,candidate,contentDecisions:false});
  execFileSync('gh',['api','--method','POST','repos/'+config.repository+'/check-runs','--input','-'],{
    input:JSON.stringify({name:config.context,head_sha:candidate,status:'completed',conclusion:'success',
      output:{title:'账本单条追加已核实',summary:'候选签名、当前父提交和决定结构均已核实。'}}),
    timeout:10000,stdio:['pipe','ignore','pipe'],
  });
  console.log(JSON.stringify(verified));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main(process.argv.slice(2));
