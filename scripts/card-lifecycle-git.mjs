import { execFileSync } from 'node:child_process';
import { lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync,realpathSync,rmSync, writeFileSync } from 'node:fs';
import { dirname, join,posix } from 'node:path';
import { fail,hash } from '../lib/siyuan.mjs';
import { loadRawTree } from '../lib/raw-format.mjs';
import { fetchBranchHead, readBranchCommit } from './github-branch-reader.mjs';

const sha = /^[a-f0-9]{40}$/;
const operation = /^[a-f0-9-]{36}$/;
const rawTracked = path => path.startsWith('raw/') || path.startsWith('server/share-materials/');
function safePath(path) {
  return typeof path === 'string' && rawTracked(path) &&
    !/[\\\x00-\x1f]/.test(path) && path.split('/').every(part => part && part !== '.' && part !== '..');
}
export function lifecycleFileIdentity(tree,path) {
  if (!safePath(path)) fail('outside_scope','原稿补丁路径越界。');
  const full=join(tree,path);
  for (let parent=dirname(full); parent!==tree; parent=dirname(parent)) {
    const entry=lstatSync(parent,{throwIfNoEntry:false});
    if (entry && !entry.isDirectory()) fail('outside_scope','原稿补丁父路径不是普通目录。');
  }
  const entry=lstatSync(full,{throwIfNoEntry:false});
  if (!entry) return null;
  if (!entry.isFile()) fail('outside_scope','原稿补丁目标不是普通文件。');
  return {sha256:hash(readFileSync(full)),executable:Boolean(entry.mode&0o111)};
}
export function sameLifecycleFile(left,right) {
  if (left===null || right===null) return left===right;
  return Boolean(left && right && left.sha256===right.sha256 && left.executable===right.executable);
}
export function describeLifecyclePatch(tree,edits) {
  return [...edits.keys()].sort().map(path=>{
    const before=lifecycleFileIdentity(tree,path);
    const bytes=edits.get(path);
    const after=bytes===null ? null : {sha256:hash(bytes),executable:before?.executable ?? false};
    return {path,before,after};
  });
}
export function verifyLifecycleCandidate(git,batch,commit) {
  if (batch.filePlanVersion===0) return;
  if (batch.filePlanVersion!==1 || !batch.filePlan || batch.candidate!==commit)
    fail('operation_conflict','缺少该批次候选的冻结文件清单。');
  const expected=JSON.parse(batch.filePlan);
  if (!Array.isArray(expected)) fail('operation_conflict','同步批次的文件清单格式不符。');
  const paths=new Set(expected.map(entry=>entry.path));
  if (paths.size!==expected.length || git.changedPaths(batch.parent,commit).some(path=>!paths.has(path)))
    fail('content_conflict','同步候选涉及未冻结的文件。');
  git.inspect(commit,(_,tree)=>{
    for (const {path,after} of expected)
      if (!sameLifecycleFile(lifecycleFileIdentity(tree,path),after))
        fail('content_conflict','同步候选与冻结的原稿或附件不一致。');
  });
}

/** Use a dedicated Git clone. The operator's checkout is never used for edits. */
export function openCardLifecycleGit({ cwd, remote, branch = 'main', readBranch }) {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(remote ?? '') || !/^[a-zA-Z0-9][a-zA-Z0-9_/-]*$/.test(branch))
    fail('invalid_input', 'Git 远端或分支名称无效。');
  const ref = 'refs/heads/' + branch;
  const tracking = 'refs/concept-lifecycle-remote/' + remote + '/' + branch;
  function git(args, workDir = cwd) {
    return execFileSync('git', ['-c', 'core.hooksPath=/dev/null', '--literal-pathspecs', ...args], {
      cwd:workDir, timeout:60000, encoding:'utf8', maxBuffer:8*1024*1024, stdio:['ignore', 'pipe', 'pipe']
    }).trim();
  }
  git(['check-ref-format', ref]);
  const trees=join(realpathSync(git(['rev-parse','--path-format=absolute','--git-common-dir'])),'concept-lifecycle-trees');
  mkdirSync(trees,{recursive:true,mode:0o700});
  if (!lstatSync(trees).isDirectory() || (lstatSync(trees).mode & 0o077))
    fail('outside_scope','Git 临时工作树目录必须为私有目录。');
  function checkedCommit(value) {
    if (typeof value !== 'string' || !sha.test(value)) fail('invalid_input', '需要完整的 Git 提交 ID。');
    return value;
  }
  function pin(id) {
    if (typeof id !== 'string' || !operation.test(id)) fail('invalid_input', '操作 ID 无效。');
    return 'refs/concept-lifecycle-candidate/' + id;
  }
  const observedHead = () => git(['for-each-ref', '--format=%(objectname)', tracking]) || null;
  const fetched = tracking + '-fetched';
  function recordHead(previous,head) {
    if (previous && git(['merge-base', previous, head]) !== previous)
      fail('content_conflict', '原稿分支已回退或改写历史。');
    git(['update-ref', tracking, head, previous || '0'.repeat(40)]);
    return head;
  }
  function snapshot() {
    return recordHead(observedHead(),fetchBranchHead(git,remote,ref,fetched));
  }
  async function readSnapshot() {
    if (!readBranch) return snapshot();
    const previous=observedHead();
    const head=await readBranchCommit({git,remote,branch,readBranch,destination:fetched});
    return recordHead(previous,head);
  }
  function withTree(commit, fn) {
    checkedCommit(commit);
    const base = mkdtempSync(join(trees,'tree-'));
    const tree = join(base, 'checkout');
    let added = false;
    function cleanup() {
      if (added) git(['worktree', 'remove', '--force', tree]);
      rmSync(base, { recursive:true, force:true });
    }
    let result;
    try {
      git(['worktree', 'add', '--detach', '--quiet', tree, commit]);
      added = true;
      result = fn(tree);
    } catch (error) {
      cleanup();
      throw error;
    }
    if (result?.then) return result.finally(cleanup);
    cleanup();
    return result;
  }
  function changes(from, to) {
    const files = git(['diff', '--no-renames', '--name-only', '-z', from, to]).split('\0').filter(Boolean);
    if (!files.every(safePath)) fail('outside_scope', 'Git 候选包含原稿或分享材料范围外的文件。');
    return files;
  }
  function candidate(id, base) {
    checkedCommit(base);
    const stored = git(['for-each-ref', '--format=%(objectname)', pin(id)]);
    if (!stored) return null;
    checkedCommit(stored);
    if (stored !== base && git(['show', '-s', '--format=%P', stored]) !== base)
      fail('operation_conflict', '已保存候选与确认时的父提交不符。');
    changes(base, stored);
    return stored;
  }
  function storeCandidate(id, base, write) {
    const previous = candidate(id, base);
    if (previous) return previous;
    const commit = withTree(base, tree => {
      write(tree);
      if (!git(['status', '--porcelain', '--untracked-files=all'], tree)) return base;
      loadRawTree(join(tree, 'raw'));
      git(['add', '-A'], tree);
      const staged = git(['diff', '--cached', '--no-renames', '--name-only', '-z'], tree).split('\0').filter(Boolean);
      if (!staged.every(safePath)) fail('outside_scope', 'Git 候选包含原稿或分享材料范围外的文件。');
      if (!staged.length) return base;
      git(['commit', '-m', '维护知识卡 ' + id], tree);
      const saved = git(['rev-parse', 'HEAD'], tree);
      changes(base, saved);
      return saved;
    });
    git(['update-ref', pin(id), commit, '0'.repeat(40)]);
    return commit;
  }
  function status(id, base) {
    const commit = candidate(id, base);
    const head = snapshot();
    if (!commit) return { head, state:head === base ? 'unstaged' : 'conflict' };
    if (commit === head) return { head, commit, state:'published' };
    if (head === base) return { head, commit, state:'prepared' };
    if (git(['merge-base', head, commit]) !== commit) return { head, commit, state:'conflict' };
    const paths = changes(base, commit);
    const modified = paths.length && git(['diff', '--name-only', '-z', commit, head, '--', ...paths]);
    return { head, commit, state:modified ? 'published-conflict' : 'published' };
  }
  function cleanWorktrees() {
    const list=git(['worktree','list','--porcelain','-z']).split('\0');
    const main=realpathSync(cwd);
    for (const row of list.filter(row=>row.startsWith('worktree '))) {
      const root=row.slice('worktree '.length);
      if (root===main) continue;
      const directory=dirname(root);
      if (dirname(directory)!==trees || !/^tree-[a-zA-Z0-9]+$/.test(posix.basename(directory)) ||
          root!==join(directory,'checkout'))
        fail('outside_scope','专用 Git 副本存在需要核对的工作树。');
      git(['worktree','remove','--force',root]);
    }
    for (const name of readdirSync(trees,{withFileTypes:true})) {
      if (!name.isDirectory() || !/^tree-[a-zA-Z0-9]+$/.test(name.name))
        fail('outside_scope','专用 Git 工作树目录包含其他资源。');
      rmSync(join(trees,name.name),{recursive:true,force:true});
    }
  }
  function shareEntry(commit,rawId) {
    const path='server/share-materials/catalog.json';
    if (!git(['ls-tree','--name-only',commit,'--',path])) return null;
    const entries=JSON.parse(git(['show',commit+':'+path]));
    return Object.hasOwn(entries,rawId) ? entries[rawId] : null;
  }
  function clearUnpublishedCardCopies({rawId,sourcePath},decision) {
    const head=snapshot();
    checkedCommit(decision.mainCommit);
    if (git(['merge-base',head,decision.mainCommit])!==decision.mainCommit)
      fail('content_conflict','权威删除决定的原稿提交尚未读回。');
    if (typeof sourcePath!=='string' || !safePath('raw/'+sourcePath) ||
        !sourcePath.endsWith('/article.md') || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(rawId ?? ''))
      fail('outside_scope','无法核实待清理的原稿范围。');
    cleanWorktrees();
    const prefix='raw/'+posix.dirname(sourcePath)+'/';
    const cover='server/share-materials/covers/'+rawId+'.png';
    const pins=git(['for-each-ref','--format=%(refname) %(objectname)','refs/concept-lifecycle-candidate/']);
    for (const line of pins.split('\n').filter(Boolean)) {
      const [ref,commit]=line.split(' ');
      checkedCommit(commit);
      if (git(['merge-base',head,commit])===commit) continue;
      const parents=git(['show','-s','--format=%P',commit]).split(' ');
      if (parents.length!==1) fail('content_conflict','无法核实未发布候选的父提交。');
      const parent=checkedCommit(parents[0]);
      if (git(['merge-base',head,parent])!==parent)
        fail('content_conflict','未发布候选的父提交尚未核实。');
      const paths=changes(parent,commit);
      const touched=paths.some(path=>path.startsWith(prefix)||path===cover) ||
        (paths.includes('server/share-materials/catalog.json') &&
          JSON.stringify(shareEntry(parent,rawId))!==JSON.stringify(shareEntry(commit,rawId)));
      if (touched) git(['update-ref','-d',ref,commit]);
    }
    // The clone is scoped to this maintenance process. Reachable history and
    // other pinned candidates remain available.
    git(['-c','gc.autoDetach=false','gc','--prune=now']);
  }
  function editFile(root, path, bytes) {
    if (!safePath(path)) fail('outside_scope', '原稿补丁路径越界。');
    const file = join(root, path);
    let current = file;
    while (current !== root) {
      if (lstatSync(current, { throwIfNoEntry:false })?.isSymbolicLink()) fail('outside_scope', '原稿路径含符号链接。');
      current = dirname(current);
    }
    if (bytes === null) rmSync(file, { force:true });
    else {
      mkdirSync(dirname(file), { recursive:true });
      writeFileSync(file, bytes);
    }
  }
  return {
    snapshot,observedHead,readSnapshot,
    assertRawUnchanged(commit) {
      checkedCommit(commit);
      const head = snapshot();
      if (git(['merge-base', head, commit]) !== commit ||
          git(['diff', '--name-only', '-z', commit, head, '--', 'raw', 'server/share-materials']))
        fail('content_conflict', '已确认的原稿基线出现并发变更。');
    },
    inspect(base, fn) { return withTree(base, tree => fn(join(tree, 'raw'), tree)); },
    stage(id, base, makePatch) {
      return storeCandidate(id, base, tree => {
        const patch = makePatch(tree);
        for (const [path, bytes] of patch) editFile(tree, path, bytes);
      });
    },
    status,
    restorePreparedCandidate(id,base,commit,head) {
      checkedCommit(base);
      checkedCommit(commit);
      if (head!==base || head!==observedHead() || candidate(id,base)) return false;
      try {
        if (git(['show','-s','--format=%P',commit])!==base) return false;
      } catch (error) {
        if (typeof error.status==='number') return false;
        throw error;
      }
      changes(base,commit);
      git(['update-ref',pin(id),commit,'0'.repeat(40)]);
      return true;
    },
    restorePublishedCandidate(id,base,commit,head) {
      checkedCommit(base);
      checkedCommit(commit);
      checkedCommit(head);
      if (head!==observedHead() || candidate(id,base)) return false;
      try {
        if (git(['merge-base',commit,head])!==commit) return false;
      } catch (error) {
        if (typeof error.status==='number') return false;
        throw error;
      }
      if (commit!==base && git(['show','-s','--format=%P',commit])!==base)
        fail('operation_conflict','已发布候选与冻结的父提交不符。');
      changes(base,commit);
      git(['update-ref',pin(id),commit,'0'.repeat(40)]);
      return true;
    },
    publish(id, base) {
      const before = status(id, base);
      if (before.state !== 'prepared') return before;
      let refused = false;
      // The lease requires the observed parent; the candidate has exactly one parent.
      try { git(['push', '--porcelain', `--force-with-lease=${ref}:${base}`, remote, `${before.commit}:${ref}`]); }
      catch (error) {
        refused = typeof error.stdout === 'string' && error.stdout.split('\n').some(line =>
          line.startsWith('!\t') && line.includes('[remote rejected]'));
      }
      const after = status(id, base);
      return refused && after.state === 'prepared' ? {...after, state:'refused'} : after;
    },
    stageCompensation(id, originalId, base, expectedHead) {
      const original = status(originalId, base);
      if (original.state !== 'published') fail('content_conflict', '原稿已有后续修改，请核对后再补偿。');
      if (expectedHead && original.head !== expectedHead) fail('content_conflict','补偿预览后原稿分支已前进。');
      const paths = changes(base, original.commit);
      const commit = storeCandidate(id, original.head, tree => {
        if (paths.length) git(['restore', `--source=${base}`, '--staged', '--worktree', '--', ...paths], tree);
      });
      return { commit, parent:original.head };
    },
    originalBeforeRemoval(head,sourcePath) {
      checkedCommit(head);
      const path='raw/'+sourcePath;
      if (!safePath(path) || !sourcePath.endsWith('/article.md') || head!==observedHead())
        fail('outside_scope','只能核对已观测主分支的卡片原稿路径。');
      if (git(['ls-tree','--name-only',head,'--',path])) return null;
      const removal=git(['log','-1','--first-parent','--diff-filter=D','--format=%H',head,'--',path]);
      if (!removal) return null;
      const parent=git(['rev-parse',checkedCommit(removal)+'^1']);
      return git(['ls-tree','--name-only',parent,'--',path]) ? checkedCommit(parent) : null;
    },
    changedPaths(base, commit) {
      return changes(checkedCommit(base),checkedCommit(commit));
    },
    pathsUnchanged(from,to,paths) {
      checkedCommit(from);
      checkedCommit(to);
      if (!paths.every(safePath)) fail('outside_scope','发布读回路径超出维护范围。');
      return paths.length===0 || !git(['diff','--name-only','-z',from,to,'--',...paths]);
    },
    clearUnpublishedCardCopies,
  };
}
