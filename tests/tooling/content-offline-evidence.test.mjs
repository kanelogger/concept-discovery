import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdirSync,mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';

test('resuming trace collection cannot turn a failed cleanup or business step into a successful drill',t=>{
  const root=mkdtempSync(join(tmpdir(),'cd-offline-resume-'));
  t.after(()=>rmSync(root,{recursive:true,force:true}));
  const dir=join(root,'cd-offline-0123456789ab');
  mkdirSync(dir);
  for (const mismatch of [{functionalPassed:false},{cleaned:false},{cleanupFailure:'owned container remains'},
    {observationIncomplete:true},{failure:'readiness did not reopen',failureKind:'functional'}]) {
    const record={functionalPassed:true,cleaned:true,passed:false,...mismatch};
    const file=join(dir,'run.json');
    writeFileSync(file,JSON.stringify(record));
    const result=spawnSync(process.execPath,['tests/service/content-offline-evidence.mjs',dir],{encoding:'utf8'});
    assert.notEqual(result.status,0);
    assert.match(result.stderr,/Functional and cleanup receipts/);
    assert.deepEqual(JSON.parse(readFileSync(file)),record);
  }
});
