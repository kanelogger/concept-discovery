import { randomUUID } from 'node:crypto';
import { fail } from '../lib/siyuan.mjs';
import { githubInstallationToken } from './github-app-installation.mjs';

const commitId = value => typeof value === 'string' && /^[a-f0-9]{40}$/.test(value);

/** One credential per installation; each observation must reach the exact remote ref. */
export function githubBranchReader({repository,writerInstallation}, {
  fetcher=fetch,issueToken=githubInstallationToken,now=()=>performance.now(),
}={}) {
  if (typeof repository !== 'string' || !/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/.test(repository) ||
      repository.split('/').some(part=>part==='.' || part==='..') || writerInstallation?.repository!==repository)
    fail('invalid_input','GitHub 分支读取身份与目标仓库不符。');
  const api = 'https://api.github.com/repos/'+repository+'/git/';
  let token, refreshAt=0;
  return async branch=>{
    if (typeof branch!=='string' || !/^[a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9_-]+)*$/.test(branch))
      fail('invalid_input','GitHub 分支名无效。');
    if (!token || now()>=refreshAt) {
      token=await issueToken(writerInstallation,'reader');
      refreshAt=now()+240000;
    }
    const path='heads/'+branch;
    const response=await fetcher(api+'ref/'+path+'?nonce='+randomUUID(),{
      method:'GET',cache:'no-store',redirect:'error',signal:AbortSignal.timeout(5000),
      headers:{Accept:'application/vnd.github+json',Authorization:'Bearer '+token,'Cache-Control':'no-cache, no-store'},
    });
    if (response.status!==200 || response.redirected) {
      if (response.status===401 || response.status===403) token=null;
      fail('git_unavailable','GitHub 未确认当前分支。');
    }
    const result=await response.json();
    const sha=result?.object?.sha;
    if (result?.ref!=='refs/'+path || result.url!==api+'refs/'+path || result.object?.type!=='commit' ||
        !commitId(sha) || result.object.url!==api+'commits/'+sha)
      fail('git_unavailable','GitHub 响应与指定仓库、分支或提交不符。');
    return sha;
  };
}

export function fetchBranchHead(git,remote,ref,destination) {
  git(['fetch','--no-tags','--no-write-fetch-head',remote,'+'+ref+':'+destination]);
  return git(['rev-parse','--verify',destination]);
}

/** A missing object can be hydrated only from the ref observed by the API. */
export async function readBranchCommit({readBranch,git,remote,branch,destination}) {
  const head=await readBranch(branch);
  if (!commitId(head)) fail('git_unavailable','未取得完整提交 ID。');
  try {
    if (git(['rev-parse','--verify','--quiet',head+'^{object}'])!==head)
      fail('git_unavailable','本地对象与已核实的提交 ID 不符。');
  }
  catch (error) {
    if (error.status!==1) throw error;
    if (fetchBranchHead(git,remote,'refs/heads/'+branch,destination)!==head)
      fail('git_unavailable','Git 拉取结果与 GitHub 刚核实的分支头不符。');
  }
  if (git(['cat-file','-t',head])!=='commit') fail('git_unavailable','分支所指的对象不是提交。');
  return head;
}
