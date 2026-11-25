import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { setTimeout as wait } from 'node:timers/promises';
import { fail } from '../lib/siyuan.mjs';
import { githubInstallationToken } from './github-app-installation.mjs';

export function requireGithubLedgerRemote(cwd,remote,repository,{writing=false}={}) {
  if (!/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/.test(repository ?? '') || !/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(remote ?? ''))
    fail('invalid_input','GitHub 账本仓库或远端无效。');
  const expected = [`https://github.com/${repository}`,`git@github.com:${repository}`,`ssh://git@github.com/${repository}`];
  for (const flags of writing ? [[],['--push']] : [[]]) {
    const actual = execFileSync('git',['remote','get-url','--all',...flags,remote],
      {cwd,encoding:'utf8',timeout:5000,stdio:['ignore','pipe','pipe']}).trim();
    if (!expected.includes(actual.replace(/\.git$/,'')))
      fail('outside_scope','GitHub 校验仓库与实际账本远端不同。');
  }
}

function githubCheckClient({repository,tokenFile}) {
  const token = tokenFile ? readFileSync(tokenFile,'utf8').trim() : null;
  return async (commit, context, app, installationToken)=>{
    const query = new URLSearchParams({check_name:context,app_id:String(app),filter:'latest'});
    const response = await fetch(`https://api.github.com/repos/${repository}/commits/${commit}/check-runs?${query}`,{
      headers:{Accept:'application/vnd.github+json',...((installationToken ?? token) && {Authorization:'Bearer '+(installationToken ?? token)})},
      signal:AbortSignal.timeout(5000),redirect:'error',
    });
    if (!response.ok) fail('ledger_pending','GitHub 尚未返回候选校验结果。');
    return (await response.json()).check_runs;
  };
}

/** Stage before the immutable push. The independent checker owns its credentials. */
export function githubDeletionLedgerGate({repository,prefix,verifier,context,tokenFile,writerInstallation},
  {readChecks,dispatch=fetch,issueWriterToken=githubInstallationToken,attempts=12,interval=2500}={}) {
  if (!/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/.test(repository ?? '') || !/^ledger-candidates\/[a-z0-9-]+$/.test(prefix ?? '') ||
      !Number.isSafeInteger(verifier) || verifier < 1 || typeof context !== 'string' || !context)
    fail('invalid_input','缺少独立 GitHub 账本校验身份和候选分支。');
  if (writerInstallation && (writerInstallation.repository !== repository || writerInstallation.appId === verifier))
    fail('invalid_input','GitHub 写入应用与独立校验应用配置不符。');
  const checks = readChecks ?? githubCheckClient({repository,tokenFile});
  return async ({candidate,remote,git})=>{
    if (!/^[a-f0-9]{40}$/.test(candidate ?? '')) fail('invalid_input','候选提交标识无效。');
    try { git(['push','--porcelain',remote,candidate+':refs/heads/'+prefix+'/'+candidate]); }
    catch { fail('ledger_pending','候选提交尚未发布到独立校验分支。'); }
    const token = writerInstallation ? await issueWriterToken(writerInstallation,'writer') : null;
    for (let attempt=0;attempt<attempts;attempt++) {
      const runs = await checks(candidate,context,verifier,token);
      const check = runs?.find(run=>run.head_sha === candidate && run.name === context &&
        run.app?.id === verifier && run.status === 'completed');
      if (check?.conclusion === 'success') return;
      if (check) fail('ledger_conflict','独立校验拒绝该账本候选。');
      if (attempt === 0 && writerInstallation) {
        const response = await dispatch(`https://api.github.com/repos/${repository}/dispatches`,{
          method:'POST',redirect:'error',signal:AbortSignal.timeout(8000),
          headers:{Accept:'application/vnd.github+json',Authorization:'Bearer '+token,'Content-Type':'application/json'},
          body:JSON.stringify({event_type:'concept-ledger-candidate',client_payload:{candidate,prefix}}),
        });
        if (!response.ok) fail('ledger_pending','GitHub 未接受独立校验任务。');
      }
      if (attempt+1<attempts) await wait(interval);
    }
    fail('ledger_pending','仍在等待独立校验已冻结的候选。');
  };
}
