import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { openGitDeletionLedger } from '../../scripts/git-deletion-ledger.mjs';
import { openCardLifecycleGit } from '../../scripts/card-lifecycle-git.mjs';
import { openCardLifecycleTasks } from '../../scripts/card-lifecycle-tasks.mjs';
import { createCardLifecyclePurge } from '../../scripts/card-lifecycle-purge.mjs';

// A fresh OS process for each restart after a completed synthetic purge.
const mode=process.argv[2];
const input=JSON.parse(readFileSync(0,'utf8'));
const api=[];
const readBranch=async branch=>{
  api.push(branch);
  return branch==='main' ? input.main : input.ledgerHead;
};
const ledger=openGitDeletionLedger({...input.ledger,readBranch});
const git=openCardLifecycleGit({cwd:input.ledger.cwd,remote:input.ledger.remote,readBranch});
const tasks=openCardLifecycleTasks(join(input.root,'tasks.sqlite'),{databaseFirst:true});
try {
  assert.equal(tasks.get(input.taskId).state,'complete');
  assert.equal(ledger.needsGitReadback(),mode!=='passive');
  const purge=createCardLifecyclePurge({git,ledger,stateDir:input.root,materialsRoot:input.materialsRoot,
    shares:{purged:()=>true},rpc(name) {
      if (name==='raw-target') return input.library;
      assert.equal(name,'raw-verify-purge');
      return true;
    }});
  const verify=()=>ledger.verifyForServing(()=>purge.verifyRecovery(tasks),()=>purge.verifyReadiness(tasks));
  if (mode==='offline') {
    await assert.rejects(purge.verifyReadiness(tasks),{code:'operation_pending'});
    await assert.rejects(verify(),/fetch/);
    assert.equal(ledger.needsGitReadback(),true);
  } else {
    assert.ok(['reconnected','passive'].includes(mode));
    assert.deepEqual(await verify(),{ledgerHead:input.ledgerHead});
    assert.equal(ledger.needsGitReadback(),false);
  }
  assert.deepEqual(api,mode==='passive' ? [input.ledger.branch,'main',input.ledger.branch,'main'] : []);
} finally {
  tasks.close();
  ledger.close();
}
