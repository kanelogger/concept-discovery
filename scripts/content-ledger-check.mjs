import { githubInstallationToken } from './github-app-installation.mjs';

function requireConfig(condition,message) {
  if (!condition) throw new Error(message);
}

export function contentCheckSettings(config,role) {
  const {repository,prefix,verifier,context,writerInstallation,verifierInstallation,writer}=config.githubGate ?? {};
  const installation=role==='writer' ? writerInstallation : verifierInstallation;
  const writerId=role==='writer' ? writerInstallation?.appId : writer;
  requireConfig(typeof repository==='string' && /^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/.test(repository) &&
    !repository.split('/').some(part=>part==='.' || part==='..') &&
    (!config.authority?.repository || repository===config.authority.repository) &&
    /^ledger-candidates\/[a-z0-9-]+$/.test(prefix ?? '') && typeof context==='string' && context.trim() &&
    Number.isSafeInteger(verifier) && verifier>0 && Number.isSafeInteger(writerId) && writerId>0 && writerId!==verifier &&
    installation?.repository===repository && (role==='writer' || installation.appId===verifier),
    '需要分离的写入与验证应用、对应仓库、候选命名空间和必需检查名称');
  requireConfig(role==='writer' ? !verifierInstallation : !writerInstallation,'写入与独立验证使用各自的专属配置');
  return {repository,prefix,verifier,context,installation};
}

async function checkRequest(config,role,transport,{path,body}) {
  // Synthetic bare remotes can only use an explicitly injected test service.
  requireConfig(!config.authority?.localBare || (transport?.fetcher && transport?.issueToken),
    '隔离本地库需要独立的合成检查服务');
  const {repository,installation}=contentCheckSettings(config,role);
  const token=await (transport?.issueToken ?? githubInstallationToken)(installation,role);
  const response=await (transport?.fetcher ?? fetch)('https://api.github.com/repos/'+repository+path,{
    method:body?'POST':'GET',redirect:'error',cache:'no-store',signal:AbortSignal.timeout(10000),
    headers:{Accept:'application/vnd.github+json',Authorization:'Bearer '+token,...(body && {'Content-Type':'application/json'})},
    ...(body && {body:JSON.stringify(body)}),
  });
  requireConfig(response.ok,'GitHub 未确认指定提交的独立检查');
  return response.json();
}

export async function requireSuccessfulContentCheck(config,candidate,transport) {
  const {context,verifier}=contentCheckSettings(config,'writer');
  const query=new URLSearchParams({check_name:context,app_id:String(verifier),filter:'latest',per_page:'100'});
  const result=await checkRequest(config,'writer',transport,{path:'/commits/'+candidate+'/check-runs?'+query});
  const matches=result.check_runs?.filter(run=>run.head_sha===candidate && run.name===context && run.app?.id===verifier);
  requireConfig(Array.isArray(matches) && matches.length>0 && result.total_count===result.check_runs.length &&
    matches.every(run=>Number.isSafeInteger(run.id) && run.id>0),'等待指定 verifier App 对当前候选的成功检查');
  const latest=matches.reduce((last,run)=>run.id>last.id ? run : last);
  requireConfig(latest.status==='completed' && latest.conclusion==='success','等待指定 verifier App 对当前候选的最新成功检查');
}

// Git and SSH verification run in this independent station-side checkout.
// The verifier App only records the result; no repository_dispatch is sent.
export async function postContentCandidateCheck(config,candidate,verify,transport) {
  const {context,verifier}=contentCheckSettings(config,'verifier');
  let verified;
  try {
    verified=verify();
  } catch (error) {
    if (error.code!=='ledger_changed') throw error;
  }
  const conclusion=verified?'success':'failure';
  const run=await checkRequest(config,'verifier',transport,{path:'/check-runs',body:{
    name:context,head_sha:candidate,status:'completed',conclusion,
    output:verified?{title:'账本追加已核实',summary:'本机核实候选签名、权威父提交、追加结构和同库身份映射。'}:
      {title:'账本候选已拒绝',summary:'候选签名、追加结构或同库身份映射不符。'},
  }});
  requireConfig(Number.isSafeInteger(run.id) && run.id>0 && run.name===context && run.head_sha===candidate && run.app?.id===verifier &&
    run.status==='completed' && run.conclusion===conclusion,'GitHub 读回的校验身份、提交或结论不符');
  requireConfig(verified,'独立校验拒绝了账本候选');
  return {...verified,verifier,context,checkRunId:run.id};
}
