import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { canonical, hash } from '../lib/read-contract.mjs';
import { openContentReader } from '../server/content-reader.mjs';
import { requireGithubLedgerRemote } from './github-deletion-ledger-gate.mjs';
import { contentCheckSettings, postContentCandidateCheck, requireSuccessfulContentCheck } from './content-ledger-check.mjs';
import { validateSignedDecision } from './git-deletion-ledger.mjs';
import { readLedgerAppend, verifyDeletionLedgerAppend, verifyLedgerSignature } from './verify-deletion-ledger-append.mjs';

const sha = value => typeof value === 'string' && /^[a-f0-9]{40}$/.test(value);
const digest = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const encoded = value => JSON.stringify(canonical(value));
const zero = '0'.repeat(40);
function requireValue(condition,message) {
  if (!condition) throw new Error(message);
}
function runGit(cwd,args,options={}) {
  return execFileSync('git',['--no-replace-objects',...args],{
    cwd,encoding:'utf8',timeout:60_000,maxBuffer:16*1024*1024,stdio:['pipe','pipe','pipe'],...options,
  });
}
function jsonFile(path) { return JSON.parse(readFileSync(path,'utf8')); }

// Keep a content-free receipt of an owner-confirmed public release. Check the
// compiler's complete raw input against both the frozen files and the Git tree.
export function captureContentPublication({cwd,sourceCommit,rawRoot,publishedRelease,libraryId,manifestSha256}) {
  requireValue(sha(sourceCommit) && digest(manifestSha256),'需要已核准的发布清单摘要和原稿提交');
  const git = (...args)=>runGit(cwd,args);
  requireValue(git('cat-file','-t',sourceCommit).trim()==='commit','原稿提交无效');
  const entries = git('ls-tree','-rz',sourceCommit+':raw').split('\0').filter(Boolean);
  const root = realpathSync(rawRoot);
  const files = new Map();
  for (const entry of readdirSync(root,{recursive:true,withFileTypes:true})) {
    if (entry.isDirectory()) continue;
    const absolute = join(entry.parentPath,entry.name);
    const name = relative(root,absolute).split(sep).join('/').normalize('NFC');
    requireValue(entry.isFile() && !files.has(name),'冻结原稿含特殊文件或规范化后的重名');
    files.set(name,absolute);
  }
  const digests = new Map();
  for (const entry of entries) {
    const match = /^(?:100644|100755) blob ([0-9a-f]{40})\t([\s\S]+)$/.exec(entry);
    requireValue(match,'原稿提交含未核实的目录项');
    const path = match[2].normalize('NFC');
    requireValue(files.has(path) && !digests.has(path),'原稿文件与所选提交不符');
    const bytes = readFileSync(files.get(path));
    const blobId=createHash('sha1').update('blob '+bytes.length+'\0').update(bytes).digest('hex');
    requireValue(blobId===match[1],'原稿文件与所选提交不符');
    digests.set(path,hash(bytes));
  }
  requireValue(digests.size===files.size,'原稿目录和提交的文件集合不同');
  const rawDigest=hash([...digests.keys()].sort().map(path=>[path,digests.get(path)]));
  const bytes = readFileSync(join(publishedRelease,'manifest.json'));
  requireValue(hash(bytes)===manifestSha256 && JSON.parse(bytes).inputs?.raw===rawDigest,'原稿提交与核准的发布内容不符');
  const reader = openContentReader({directory:publishedRelease,libraryId,manifestSha256,origin:'https://local.invalid'});
  try {
    return {version:1,libraryId,sourceCommit,manifestSha256,activeIds:reader.inventory().activeIds.sort()};
  } finally { reader.close(); }
}

function mapping(config) {
  const bytes = readFileSync(config.evidenceFile);
  requireValue(digest(config.evidenceSha256) && hash(bytes)===config.evidenceSha256,'冻结对照材料摘要不符');
  const evidence = JSON.parse(bytes);
  requireValue(evidence.version===1 && evidence.libraryId===config.libraryId &&
    Array.isArray(evidence.tasks) && Array.isArray(evidence.publications),'缺少同库冻结对照材料');
  const tasks = new Map(evidence.tasks.map(task=>[task.id,task]));
  requireValue(tasks.size===evidence.tasks.length,'冻结维护操作 ID 冲突');
  const publications = new Map(evidence.publications.map(record=>[hash(canonical(record)),record]));
  const inventories = new Map();
  for (const record of publications.values()) {
    requireValue(record.version===1 && record.libraryId===config.libraryId && sha(record.sourceCommit) &&
      digest(record.manifestSha256) && Array.isArray(record.activeIds) &&
      record.activeIds.every(id=>typeof id==='string' && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id)) &&
      new Set(record.activeIds).size===record.activeIds.length,'先前发布的活动主卡收据无效');
    const inventory = hash([...record.activeIds].sort());
    requireValue(!inventories.has(record.manifestSha256) || inventories.get(record.manifestSha256)===inventory,
      '同一发布清单的主卡库存冲突');
    inventories.set(record.manifestSha256,inventory);
  }
  return function mapDecision(decision) {
    requireValue(decision.library===config.libraryId,'决定与核准知识库身份不同');
    if (decision.version===2) {
      const record = publications.get(decision.publicationSha256);
      requireValue(record && record.sourceCommit===decision.sourceCommit && record.activeIds.includes(decision.publicId),
        '决定无法匹配已核准的历史发布、原稿提交和稳定主卡 ID');
      return decision.outcome==='cancelled' ? null : decision.publicId;
    }
    if (decision.outcome==='cancelled') return null;
    const task = tasks.get(decision.opId);
    const plan = task?.plan;
    const native = plan?.deletion?.native;
    const main = native?.id;
    requireValue(task?.state==='complete' && task.progress?.commit===decision.mainCommit &&
      plan?.action==='purge' && plan.library===decision.library && plan.rawId===decision.rawId &&
      hash(canonical(plan))===decision.previewDigest && main===plan.evidence?.id &&
      decision.documents.includes(main) && Array.isArray(native.documents) &&
      encoded(native.documents.map(doc=>doc.id).sort())===encoded([...decision.documents].sort()),
    '永久决定与冻结的旧操作、主卡或文档清单不符');
    return main;
  };
}

function checkAuthority({authority,cwd,remote},writing=false) {
  if (authority?.repository && !authority.localBare) return requireGithubLedgerRemote(cwd,remote,authority.repository,{writing});
  requireValue(!authority?.repository && isAbsolute(authority?.localBare ?? '') &&
    runGit(authority.localBare,['rev-parse','--is-bare-repository']).trim()==='true','缺少已核准的权威本地演练库');
  for (const flags of writing ? [[],['--push']] : [[]]) {
    const url=runGit(cwd,['remote','get-url','--all',...flags,remote]).trim();
    requireValue(isAbsolute(url) && realpathSync(url)===realpathSync(authority.localBare),'演练账本与指定本地库不同');
  }
}

export function openContentLedger(config,transport) {
  const {cwd,remote,branch,anchor,minimumHead,allowedSignersFile,libraryId} = config;
  requireValue(sha(anchor) && sha(minimumHead) && typeof remote==='string' && /^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(remote) &&
    typeof branch==='string' && /^[a-zA-Z0-9][a-zA-Z0-9_/-]*$/.test(branch) && branch!=='main' &&
    typeof libraryId==='string' && libraryId.trim() && isAbsolute(allowedSignersFile),'需要站主核实的账本分支、起点、最低头部及签署者');
  const git = (...args)=>runGit(cwd,['-c','gpg.format=ssh','-c','gpg.ssh.allowedSignersFile='+allowedSignersFile,...args]).trim();
  const ref='refs/heads/'+branch;
  git('check-ref-format',ref);
  const floorRef='refs/content-ledger/floors/'+hash([libraryId,remote,branch,anchor]);
  function read({candidate,decision:pending}={}) {
    checkAuthority(config);
    const floor = git('for-each-ref','--format=%(objectname)',floorRef);
    const temporary='refs/content-ledger/fetch/'+randomUUID();
    try {
      git('fetch','--no-tags','--no-write-fetch-head','--refmap=',remote,ref+':'+temporary);
      const head=git('rev-parse',temporary);
      verifyLedgerSignature(git,anchor,{authority:true});
      requireValue(!git('ls-tree',anchor,'--','decisions'),'账本起点已含决定，无法证明完整历史');
      const mapDecision = mapping(config);
      const ops = new Map(), ids=new Set(), claimedRefs=new Set(), cancelled=[];
      function apply(decision,commit) {
        requireValue(!ops.has(decision.opId),'操作 ID 重复');
        const id = mapDecision(decision);
        if (id===null) cancelled.push(decision.opId);
        else {
          requireValue(!ids.has(id),'同一主卡有相互冲突的永久决定');
          const refs=decision.version===1 ? [decision.rawId,...decision.documents] : [id];
          for (const ref of new Set(refs)) {
            requireValue(!claimedRefs.has(ref),'冻结文档或原稿标识属于不同的永久决定');
            claimedRefs.add(ref);
          }
          ids.add(id);
        }
        ops.set(decision.opId,{decision,commit});
      }
      const commits=git('rev-list','--reverse','--first-parent',anchor+'..'+head).split('\n').filter(Boolean);
      const history=new Set([anchor,...commits]);
      requireValue(history.has(minimumHead) && (!floor || history.has(floor)),'权威头部早于已核准版本');
      let parent=anchor;
      for (const commit of commits) {
        apply(readLedgerAppend(git,parent,commit),commit);
        parent=commit;
      }
      requireValue(parent===head,'权威头部不在已核准的追加历史上');
      if (candidate) {
        const decision=readLedgerAppend(git,head,candidate);
        // The parent history and frozen inputs have already passed. Only a
        // deterministic candidate mapping error becomes a negative App check.
        try { apply(decision,candidate); }
        catch (cause) { throw Object.assign(new Error(cause.message,{cause}),{code:'ledger_changed'}); }
      }
      if (pending) apply(validateSignedDecision(pending),null);
      requireValue(git('ls-remote','--exit-code','--refs',remote,ref)===head+'\t'+ref,'核准期间权威分支已变化');
      // Concurrent readers must never move the local high-water mark backwards.
      try { git('update-ref',floorRef,head,floor || zero); }
      catch (error) {
        if (git('for-each-ref','--format=%(objectname)',floorRef)!==head) throw error;
      }
      const deletions={version:1,libraryId,deletedIds:[...ids].sort()};
      return {ledgerHead:head,deletions,deletionsSha256:hash(deletions),cancelled,ops};
    } finally { git('update-ref','-d',temporary); }
  }
  function prepare(decision) {
    requireValue(decision?.version===2 && isAbsolute(config.signingKey ?? ''),'签署公开主卡决定需要本机私钥及版本 2 决定');
    const {ledgerHead:parent}=read({decision});
    const file='decisions/'+decision.opId+'.json';
    const directory=mkdtempSync(join(tmpdir(),'cd-content-ledger-'));
    try {
      const env={...process.env,GIT_INDEX_FILE:join(directory,'index')};
      const index = (...args)=>runGit(cwd,args,{env}).trim();
      index('read-tree',parent);
      const blob=runGit(cwd,['hash-object','-w','--stdin'],{input:encoded(decision)+'\n'}).trim();
      index('update-index','--add','--cacheinfo','100644,'+blob+','+file);
      const tree=index('write-tree');
      const candidate=git('-c','user.signingkey='+config.signingKey,'commit-tree','-S',tree,'-p',parent,'-m','Record deletion '+decision.opId);
      readLedgerAppend(git,parent,candidate,true);
      git('update-ref','refs/content-ledger/candidates/'+candidate,candidate);
      return {parent,candidate,opId:decision.opId};
    } finally { rmSync(directory,{recursive:true,force:true}); }
  }
  function stagedRef(candidate) {
    const {prefix}=contentCheckSettings(config,'writer');
    return 'refs/heads/'+prefix+'/'+candidate;
  }
  function requireStaged(candidate) {
    const staged=stagedRef(candidate);
    requireValue(git('ls-remote','--refs',remote,staged)===candidate+'\t'+staged,'候选未出现在指定的精确校验引用');
  }
  function stage(candidate) {
    requireValue(sha(candidate),'需要完整候选提交');
    checkAuthority(config,true);
    const {ledgerHead:parent}=read({candidate});
    const staged=stagedRef(candidate);
    const observed=git('ls-remote','--refs',remote,staged);
    if (!observed) git('push','--porcelain','--force-with-lease='+staged+':',remote,candidate+':'+staged);
    requireStaged(candidate);
    return {candidate,parent,staged};
  }
  async function publish(candidate) {
    requireValue(sha(candidate),'需要完整候选提交');
    checkAuthority(config,true);
    const {ops,ledgerHead:parent}=read();
    if ([...ops.values()].some(entry=>entry.commit===candidate)) return snapshot();
    requireStaged(candidate);
    await requireSuccessfulContentCheck(config,candidate,transport);
    read({candidate});
    checkAuthority(config,true);
    requireStaged(candidate);
    git('push','--porcelain','--force-with-lease='+ref+':'+parent,remote,candidate+':'+ref);
    const {ops:confirmed,...result}=read();
    requireValue([...confirmed.values()].some(entry=>entry.commit===candidate),'尚未读回已签决定');
    return result;
  }
  function snapshot() {
    const {ops,...result}=read();
    return result;
  }
  return {read:snapshot,prepare,stage,publish,checkCandidate(candidate) {
    requireValue(sha(candidate),'需要完整候选提交');
    return read({candidate}).ledgerHead;
  }};
}

export async function verifyContentCandidate(config,candidate,transport) {
  checkAuthority(config);
  const localOnly=Boolean(config.authority.localBare && !config.githubGate);
  const prefix=localOnly ? config.prefix : contentCheckSettings(config,'verifier').prefix;
  function verify() {
    const verified=verifyDeletionLedgerAppend({...config,prefix,candidate,requireTrustedParent:true,contentDecisions:true});
    const parent=openContentLedger(config).checkCandidate(candidate);
    requireValue(parent===verified.parent,'验证期间权威头部已变化');
    return verified;
  }
  return localOnly ? verify() : postContentCandidateCheck(config,candidate,verify,transport);
}

async function main([action,file,arg,...extra]) {
  const allowed=['capture','read','prepare','stage','publish','verify-candidate'];
  requireValue(allowed.includes(action) && file && !extra.length &&
    (['prepare','stage','publish','verify-candidate'].includes(action)===Boolean(arg)),
    '用法：node scripts/content-ledger.mjs capture|read|prepare|stage|verify-candidate|publish 私有配置 [决定文件或候选 SHA]');
  const config=jsonFile(file);
  if (action==='capture') {
    const publication=captureContentPublication(config);
    return {publication,publicationSha256:hash(canonical(publication))};
  }
  if (action==='verify-candidate') return verifyContentCandidate(config,arg);
  const ledger=openContentLedger(config);
  if (action==='read') return ledger.read();
  if (action==='prepare') return ledger.prepare(jsonFile(arg));
  if (action==='stage') return ledger.stage(arg);
  return ledger.publish(arg);
}
if (process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
  console.log(JSON.stringify(await main(process.argv.slice(2))));
}
