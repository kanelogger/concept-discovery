import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { canonical, hash } from '../../lib/read-contract.mjs';
import { captureContentPublication, openContentLedger } from '../../scripts/content-ledger.mjs';

const cli=fileURLToPath(new URL('../../scripts/content-ledger.mjs',import.meta.url));
const options={encoding:'utf8',timeout:60_000,stdio:['ignore','pipe','pipe']};
const git=(cwd,...args)=>execFileSync('git',args,{cwd,...options}).trim();
function json(file,value) { writeFileSync(file,JSON.stringify(value),{mode:0o600}); }

// Everything created here belongs to this one owner-side drill. No host or
// application image receives a Git working copy, private key or evidence file.
export function createContentLedgerDrill(root,{libraryId,publicId,rawRoot,publishedRelease}) {
  mkdirSync(root,{mode:0o700});
  const cwd=join(root,'owner');
  const localBare=join(root,'authority.git'), verifier=join(root,'independent');
  const branch='deletion-drill',ref='refs/heads/'+branch,prefix='ledger-candidates/drill';
  git(root,'init','--bare',localBare);
  git(root,'init',cwd);
  git(root,'init',verifier);
  const signingKey=join(root,'drill-signing'),allowedSignersFile=join(root,'allowed-signers');
  execFileSync('ssh-keygen',['-q','-t','ed25519','-N','','-f',signingKey],options);
  writeFileSync(allowedSignersFile,'owner@example.invalid '+readFileSync(signingKey+'.pub','utf8'));
  git(cwd,'config','user.name','Synthetic owner');
  git(cwd,'config','user.email','owner@example.invalid');
  git(cwd,'config','gpg.format','ssh');
  git(cwd,'config','user.signingkey',signingKey);
  git(cwd,'remote','add','drill',localBare);
  git(verifier,'remote','add','drill',localBare);
  git(cwd,'commit','--allow-empty','-S','-m','Synthetic ledger anchor');
  const anchor=git(cwd,'rev-parse','HEAD');
  git(cwd,'push','drill',anchor+':'+ref);
  cpSync(rawRoot,join(cwd,'raw'),{recursive:true});
  git(cwd,'add','--force','--','raw');
  git(cwd,'commit','-S','-m','Synthetic published originals');
  const sourceCommit=git(cwd,'rev-parse','HEAD');
  const publication=captureContentPublication({cwd,sourceCommit,rawRoot,publishedRelease,libraryId,
    manifestSha256:hash(readFileSync(join(publishedRelease,'manifest.json')))});
  const evidence={version:1,libraryId,tasks:[],publications:[publication]};
  const evidenceFile=join(root,'mapping.json');
  json(evidenceFile,evidence);
  const config={cwd,remote:'drill',branch,authority:{localBare},anchor,minimumHead:anchor,allowedSignersFile,libraryId,
    evidenceFile,evidenceSha256:hash(readFileSync(evidenceFile)),signingKey};
  const configFile=join(root,'owner.json');
  json(configFile,config);
  const verifierFile=join(root,'independent.json');
  json(verifierFile,{cwd:verifier,remote:'drill',branch,prefix,allowedSignersFile,authority:{localBare},
    anchor,minimumHead:anchor,libraryId,evidenceFile,evidenceSha256:config.evidenceSha256});
  const decision={version:2,opId:'delete-'+publicId,library:libraryId,publicId,sourceCommit,publicationSha256:hash(canonical(publication))};
  const ledger=openContentLedger(config);
  const {candidate}=ledger.prepare(decision);
  // This file represents the local verifier's successful result for the
  // exact candidate SHA, separate from the writer and the SQLite artifacts.
  const hook=join(localBare,'hooks','pre-receive');
  writeFileSync(hook,`#!/bin/sh
set -eu
while read -r old new ref; do
  if [ "$ref" = refs/heads/deletion-drill ]; then
    test -f "verified/$old-$new"
    test "$(git rev-parse "$new^")" = "$old"
  fi
done
`,{mode:0o700});
  const checked=join(localBare,'verified');
  mkdirSync(checked,{mode:0o700});
  function approve(candidateId) {
    git(cwd,'push','drill',candidateId+':refs/heads/'+prefix+'/'+candidateId);
    const result=JSON.parse(execFileSync(process.execPath,[cli,'verify-candidate',verifierFile,candidateId],options));
    writeFileSync(join(checked,result.parent+'-'+result.candidate),'verified\n',{flag:'wx',mode:0o600});
    return result;
  }
  function push(candidateId,parent) {
    return git(cwd,'push','--force-with-lease='+ref+':'+parent,'drill',candidateId+':'+ref);
  }
  approve(candidate);
  push(candidate,anchor);
  const read=()=>JSON.parse(execFileSync(process.execPath,[cli,'read',configFile],options));
  return {read,config,decision,candidate,approve,push,git,evidence,configFile,verifierFile};
}
