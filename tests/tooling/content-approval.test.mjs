import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { openContentApproval, readClosedContentApproval } from '../../lib/content-approval.mjs';
import { buildContent } from '../../scripts/build-content.mjs';
import { openContentReader } from '../../server/content-reader.mjs';

const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const save = (file,value) => writeFileSync(file,JSON.stringify(value));
const libraryId = 'approval-test-library';

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(),'cd-approval-'));
  t.after(()=>rmSync(root,{recursive:true,force:true}));
  const controlDirectory = join(root,'owner');
  mkdirSync(controlDirectory);
  const rawRoot = join(root,'raw'), metadataFile = join(root,'metadata'), baselineFile = join(root,'baseline');
  const updated = '20261126090000';
  const cards = {keeper:{id:'keeper',updated,aliases:['keeper-alias']},
    archived:{id:'archived',updated,aliases:['archived-alias']}, deleted:{id:'deleted',updated}};
  function article(id, archived = false) {
    const directory = join(rawRoot,'测试',id);
    mkdirSync(directory,{recursive:true});
    writeFileSync(join(directory,'article.md'),'---\nname: 样本 '+id+(archived?'\nstatus: archived':'')+
      '\n---\n\n## 核心理解\n\n测试 '+id+'\n');
  }
  function compile(version,previous) {
    const directory = join(root,version);
    save(metadataFile,{version:1,libraryId,cards,readings:{},history:{sources:{},proposals:{},events:{}}});
    buildContent({rawRoot,metadataFile,baselineFile,output:directory,previous});
    const reader = openContentReader({directory,libraryId,origin:'https://local.invalid'});
    t.after(()=>reader.close());
    return {reader,manifestSha256:sha(readFileSync(join(directory,'manifest.json'))),directory};
  }
  for (const id of Object.keys(cards)) article(id);
  save(baselineFile,{version:1,libraryId,sources:[],proposals:[],events:[]});
  const older = compile('before');
  article('archived',true);
  rmSync(join(rawRoot,'测试','deleted'),{recursive:true});
  delete cards.deleted;
  const current = compile('after',older.directory);
  const authIdentity = {volumeId:randomUUID(),generation:randomUUID()};
  const materialDigest = sha('synthetic catalog and materials');
  const approved = {version:1,libraryId,generation:4,state:'open',readerContract:1,
    manifestSha256:current.manifestSha256,authIdentity,materialDigest,activeIds:['keeper'],archivedIds:['archived']};
  const deletions = {version:1,libraryId,deletedIds:['deleted']};
  function publish(approval = approved,ledger = deletions) {
    const checkpoint = {version:1,libraryId,generation:approval.generation,
      approvedSha256:sha(JSON.stringify(approval)),deletionsSha256:sha(JSON.stringify(ledger))};
    save(join(controlDirectory,'approved.json'),approval);
    save(join(controlDirectory,'deletions.json'),ledger);
    save(join(controlDirectory,'checkpoint.json'),checkpoint);
    return sha(JSON.stringify(checkpoint));
  }
  const verifyAuth = (identity,deletedIds) => {
    assert.deepEqual(identity,authIdentity);
    assert.deepEqual(deletedIds,['deleted']);
  };
  const options = {controlDirectory,libraryId,...current,authIdentity,materialDigest,verifyAuth,checkpointSha256:publish()};
  return {options,older,approved,deletions,publish,root};
}

test('only the approved active primary IDs and independently pinned release, materials and auth volume open', t=>{
  const {options,older,approved,deletions,publish} = fixture(t);
  const gate = changes=>openContentApproval({...options,...changes});
  assert.equal(gate().ready(),true);
  assert.equal(options.reader.activeMain('archived'),null);
  assert.equal(options.reader.activeMain('deleted'),null);
  assert.equal(older.reader.activeMain('deleted').id,'deleted');
  for (const changes of [{libraryId:'other'}, {reader:older.reader}, {manifestSha256:older.manifestSha256},
    {materialDigest:sha('other catalog')}, {authIdentity:{...approved.authIdentity,volumeId:randomUUID()}},
    {authIdentity:{...approved.authIdentity,generation:randomUUID()}}, {checkpointSha256:undefined}, {verifyAuth:undefined}])
    assert.equal(gate(changes).ready(),false);

  // Every case below has a matching checkpoint hash. The denied decisions
  // exercise the semantic checks, independently of file integrity.
  for (const invalid of [{activeIds:['impostor']}, {activeIds:[]}, {activeIds:['keeper','keeper']},
    {archivedIds:['unknown']}, {archivedIds:['deleted']}, {archivedIds:['archived-alias']},
    {manifestSha256:older.manifestSha256}, {readerContract:0}, {libraryId:'other'}])
    assert.equal(gate({checkpointSha256:publish({...approved,...invalid})}).ready(),false);
  for (const ledger of [{...deletions,libraryId:'other'},{...deletions,deletedIds:['keeper']},
    {...deletions,deletedIds:['keeper-alias']},{...deletions,deletedIds:['archived-alias']}]) {
    assert.equal(gate({verifyAuth:()=>true,checkpointSha256:publish(approved,ledger)}).ready(),false);
  }
  // Even a checksum matching the older database cannot authorize resurrection.
  const stale = {...approved,manifestSha256:older.manifestSha256,activeIds:['deleted','archived','keeper']};
  assert.equal(gate({...older,checkpointSha256:publish(stale)}).ready(),false);
});

test('current owner files are rechecked on each use and an observed loss latches the listener closed',t=>{
  const {options,approved,deletions,publish,root} = fixture(t);
  const at = file=>join(options.controlDirectory,file);
  for (const file of ['checkpoint.json','approved.json','deletions.json']) {
    publish();
    const gate = openContentApproval(options);
    gate.assertReady();
    renameSync(at(file),join(root,'saved'));
    assert.equal(gate.ready(),false);
    renameSync(join(root,'saved'),at(file));
    assert.equal(gate.ready(),false);
    assert.equal(openContentApproval(options).ready(),true);
  }
  // The same regular file and length can contain a change beyond the first read buffer.
  const padded = {...approved,operatorNote:' '.repeat(32 * 1024)+'A'};
  const longGate = openContentApproval({...options,checkpointSha256:publish(padded)});
  longGate.assertReady();
  longGate.assertReady();
  save(at('approved.json'),{...padded,operatorNote:' '.repeat(32 * 1024)+'B'});
  assert.equal(longGate.ready(),false);
  publish();
  const gate = openContentApproval(options);
  assert.equal(gate.ready(),true);
  save(at('deletions.json'),{...deletions,deletedIds:[]});
  assert.throws(()=>gate.assertReady(),{code:'content_unavailable'});
  assert.equal(openContentApproval(options).ready(),false);

  const closed = {...approved,state:'closed',generation:5};
  const pin = publish(closed);
  assert.equal(openContentApproval({...options,checkpointSha256:pin}).ready(),false);
  assert.equal(openContentApproval(options).ready(),false);
  publish();
  assert.equal(openContentApproval({...options,checkpointSha256:pin}).ready(),false);
  renameSync(at('approved.json'),join(root,'other'));
  symlinkSync(join(root,'other'),at('approved.json'));
  assert.equal(openContentApproval(options).ready(),false);
  unlinkSync(at('approved.json'));
});

test('auth cleanup is checked for each request and closed maintenance requires the current owner checkpoint',t=>{
  const {options,approved,publish} = fixture(t);
  let cleaned = true, calls = 0;
  const gate = openContentApproval({...options,verifyAuth(expected,ids) {
    calls++;
    options.verifyAuth(expected,ids);
    if (!cleaned) throw new Error('清理未核实');
  }});
  gate.assertReady();
  cleaned=false;
  assert.equal(gate.ready(),false);
  assert.equal(calls,2);
  cleaned=true;
  assert.equal(gate.ready(),false);
  assert.throws(()=>readClosedContentApproval(options),/核准状态/);
  const closed = {version:1,libraryId,generation:6,state:'closed',authIdentity:null};
  const current = {...options,checkpointSha256:publish(closed)};
  assert.deepEqual(readClosedContentApproval(current),{libraryId,generation:6,authIdentity:null,deletedIds:['deleted']});
  assert.throws(()=>readClosedContentApproval(options),/摘要/);
  const restore = {...current,checkpointSha256:publish({...closed,authIdentity:approved.authIdentity})};
  assert.deepEqual(readClosedContentApproval(restore).authIdentity,approved.authIdentity);
});
