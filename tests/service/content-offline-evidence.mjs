import {execFileSync,spawnSync} from 'node:child_process';
import {existsSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {basename,join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';

const artifact=/^(?:capture\.status|egress\.nft|engine|platform|github-ipv4|probes\.txt|rejected-flows\.txt|control-binaries\.sha256|runc\.(?:package|version)|[a-z][a-z-]*\.(?:time|containers|nft\.json|start|end|(?:exec|fd)\.jsonl))$/;
export function collectOfflineEvidence(machine,remote,directory) {
  const owner=JSON.parse(readFileSync(join(directory,'run.json')));
  const named='/var/lib/concept-offline-drill/trace/'+owner.name;
  // Older observers assigned a random directory and are bound by their guest
  // and container snapshots. Current observers use the owner's exact run ID.
  const earlier=/^\/var\/lib\/concept-offline-drill\/trace\/run\.[a-zA-Z0-9]{8}$/.test(remote);
  if (!/^cd-routea-[a-z0-9]+$/.test(machine) || machine!==owner.machine || !/^run-[a-f0-9]{12}$/.test(owner.name) ||
      (remote!==named && !earlier))
    throw new Error('Unexpected drill evidence source');
  const orbArgs=['run','-m',machine,'-u','root','-w','/'];
  const get=(...args)=>execFileSync('orbctl',[...orbArgs,...args],{timeout:30000,maxBuffer:16*1024*1024});
  const files=get('find',remote,'-maxdepth','1','-type','f','-printf','%f\n').toString().trim().split('\n');
  if (!files.length || files.some(name=>name!=='cleanup.json' && !artifact.test(name))) throw new Error('Unexpected file in guest evidence');
  const local=join(directory,'trace');
  mkdirSync(local,{recursive:true,mode:0o700});
  for (const name of files) {
    const data=get('cat',remote+'/'+name);
    if (name==='cleanup.json') {
      // Cleanup is written after capture ends. Preserve it as a separate
      // receipt so resuming cannot change the immutable trace inventory.
      const status=JSON.parse(data);
      if (status.run!==owner.name || status.cleaned!==true || status.firewallOwner!=='absent' || status.units?.length!==0)
        throw new Error('Observer cleanup is incomplete or belongs to a different drill');
      writeFileSync(join(directory,'observer-cleanup.json'),data,{mode:0o600});
      continue;
    }
    const path=join(local,name);
    if (existsSync(path) && !readFileSync(path).equals(data)) throw new Error('Existing evidence differs: '+name);
    writeFileSync(path,data,{mode:0o600});
  }
  const review=spawnSync('python3',['tests/service/content-offline-review.py',local],{encoding:'utf8'});
  if (review.error) throw review.error;
  const receipt=JSON.parse(review.stdout);
  if ((review.status===0)!==(receipt.passed===true)) throw new Error('Trace review outcome is inconsistent');
  writeFileSync(join(directory,'trace-review.json'),review.stdout,{mode:0o600});
  return receipt;
}

// Resume trace collection after a transient transport error, without redeploying anything.
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href===import.meta.url) {
  const directory=resolve(process.argv[2]??'');
  if (!/^cd-offline-[0-9a-f]{12}$/.test(basename(directory))) throw new Error('Expected a private drill evidence directory');
  const path=join(directory,'run.json'),run=JSON.parse(readFileSync(path));
  if (!run.functionalPassed || run.cleaned!==true || run.cleanupFailure || run.observationIncomplete ||
      (run.failure && run.failureKind!=='evidence')) throw new Error('Functional and cleanup receipts must both be complete');
  run.passed=false;
  writeFileSync(path,JSON.stringify(run,null,2)+'\n');
  run.traceReview=collectOfflineEvidence(run.machine,run.observation,directory);
  run.passed=run.traceReview.passed;
  if (run.passed) { delete run.failure; delete run.failureKind; }
  writeFileSync(path,JSON.stringify(run,null,2)+'\n');
  console.log(JSON.stringify({passed:run.passed,reason:run.traceReview.reason}));
  if (!run.passed) process.exitCode=1;
}
