import { execFileSync } from 'node:child_process';
import { closeSync, copyFileSync, mkdirSync, mkdtempSync, openSync, realpathSync, renameSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { isOriginalCatalogue, planManualOriginal } from './manual-original-plan.mjs';

/** Hold Git's index lock from dependency inspection through the final rename. */
export function removeCardOriginal(cwd, args) {
  const [rawId,documentId,sourcePath,digest] = args;
  if (args.length !== 4 || !/^[a-f0-9]{64}$/.test(digest))
    throw new Error('请从站主提醒复制完整命令，并在项目仓库内执行。');
  function git(argv, options={}) {
    return execFileSync('git',['--literal-pathspecs','-c','core.hooksPath=/dev/null',...argv],{
      cwd,stdio:['pipe','pipe','pipe'],maxBuffer:128*1024*1024,...options,
    });
  }
  const tree = realpathSync(git(['rev-parse','--show-toplevel']).toString().trimEnd());
  cwd = tree;
  const index = git(['rev-parse','--path-format=absolute','--git-path','index']).toString().trimEnd();
  const lock = index+'.lock';
  const fd = openSync(lock,'wx',statSync(index).mode & 0o777);
  closeSync(fd);
  let worktreeApplied = false;
  try {
    copyFileSync(index,lock);
    const lockedGit = (argv,options) => git(argv,{env:{...process.env,GIT_INDEX_FILE:lock},...options});
    const paths = stageOriginal(tree,{rawId,documentId,sourcePath},digest,lockedGit);
    worktreeApplied = true;
    renameSync(lock,index);
    return paths;
  } catch (error) {
    if (worktreeApplied)
      throw new Error('工作区已更新，待提交索引保存在 '+lock+'。核对该索引后恢复。',{cause:error});
    rmSync(lock,{force:true});
    throw error;
  }
}

function stageOriginal(tree, target, digest, git) {
  const plan = planManualOriginal({tree,...target});
  if (plan.blockers.length || !plan.command || plan.digest !== digest)
    throw new Error('当前原稿、附件引用或分享素材与提醒不符。请核对本地改动并刷新提醒。');
  const indexTree = git(['write-tree']).toString().trim();
  for (const {path,before} of plan.files) {
    const tracked = git(['ls-tree','-z',indexTree,'--',path]).length > 0;
    const unstaged = git(['diff','--name-only','-z','--',path]).length;
    const staged = git(['diff','--cached','--name-only','-z','HEAD','--',path]).length;
    if (tracked !== Boolean(before) || unstaged || (staged && !isOriginalCatalogue(path)))
      throw new Error('路径已有本地变更，请先核对：' + path);
  }
  const temporary = mkdtempSync(join(tmpdir(),'cd-manual-original-'));
  let patch;
  try {
    const env = {...process.env,GIT_INDEX_FILE:join(temporary,'index')};
    git(['read-tree',indexTree],{env});
    const indexed = join(temporary,'staged');
    mkdirSync(indexed);
    const inventory = git(['ls-tree','-r','-z','--name-only',indexTree,'--','raw','server/share-materials']);
    git(['checkout-index','--prefix='+indexed+'/','-z','--stdin'],{env,input:inventory});
    const stagedPlan = planManualOriginal({tree:indexed,...target});
    if (stagedPlan.blockers.length || stagedPlan.digest !== digest)
      throw new Error('暂存区的原稿引用与提醒不同，请核对待提交的附件与卡片。');
    for (const {path,after} of plan.files) {
      if (after === null) {
        git(['update-index','--force-remove','--',path],{env});
      } else {
        const blob = git(['hash-object','-w','--stdin'],{input:plan.edits.get(path)}).toString().trim();
        git(['update-index','--add','--cacheinfo',after.executable?'100755':'100644',blob,path],{env});
      }
    }
    patch = git(['diff','--cached','--binary','--full-index','--no-renames','--no-ext-diff','--no-textconv',indexTree],{env});
  } finally {
    rmSync(temporary,{recursive:true,force:true});
  }
  if (!patch.length) throw new Error('没有与提醒匹配的原稿变更。');
  git(['apply','--check','--index','--binary','--whitespace=nowarn','-'],{input:patch});
  if (planManualOriginal({tree,...target}).digest !== digest)
    throw new Error('准备暂存时，原稿或附件的引用发生了变化。');
  git(['apply','--index','--binary','--whitespace=nowarn','-'],{input:patch});
  return plan.files.map(file => file.path);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const paths = removeCardOriginal(process.cwd(),process.argv.slice(2));
    console.log('已将下列变更暂存到本地。请核对 git diff --cached 后自行提交并推送。\n'+paths.join('\n'));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
