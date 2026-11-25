import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { canonical } from '../lib/siyuan.mjs';

const encode = value => JSON.stringify(canonical(value));
const mandatory = ['deletion','non_fast_forward','required_signatures','required_linear_history'];
const directIntegration = (actor,id) =>
  actor.actor_type === 'Integration' && actor.actor_id === id && actor.bypass_mode === 'always';

export function inspectLedgerBranch({rules,rulesets,branch}, {writer,verifier,context}) {
  const errors = [];
  if (branch?.protected !== true || !/^[0-9a-f]{40}$/.test(branch?.commit?.sha ?? ''))
    errors.push('分支不存在或没有启用保护');
  const observed = rules.map(rule=>{
    const detail = rulesets[rule.ruleset_id];
    if (detail?.enforcement !== 'active' || !Array.isArray(detail.bypass_actors))
      errors.push('无法核实规则的实际旁路角色：'+rule.type);
    const bypass = detail?.bypass_actors?.slice().sort((a,b)=>encode(a).localeCompare(encode(b)));
    return {type:rule.type,parameters:rule.parameters ?? {},bypass:bypass ?? null};
  });
  for (const type of mandatory) {
    if (!observed.some(rule=>rule.type === type && rule.bypass?.length === 0))
      errors.push('缺少无旁路的保护：'+type);
  }
  for (const [type,description] of [['creation','创建'],['update','更新']]) {
    const restrictions = observed.filter(rule=>rule.type === type);
    if (!restrictions.length || !restrictions.every(rule=>rule.bypass?.length === 1 && directIntegration(rule.bypass[0],writer)))
      errors.push('分支'+description+'没有限制为指定写入应用');
  }
  if (!observed.some(rule=>rule.type === 'required_status_checks' && rule.bypass?.length === 0 &&
        rule.parameters.required_status_checks?.some(check=>check.context === context && check.integration_id === verifier)))
    errors.push('缺少由指定验证应用发布的无旁路追加检查');
  if (observed.some(rule=>rule.type === 'pull_request' && !rule.bypass?.some(actor=>directIntegration(actor,writer))))
    errors.push('指定写入应用无法直接快进更新分支');
  return {head:branch?.commit?.sha ?? null,errors:[...new Set(errors)],rules:observed.sort((a,b)=>encode(a).localeCompare(encode(b)))};
}

function branchEvidence(repository,name) {
  const get = (...parts) => JSON.parse(execFileSync('gh',['api',...parts],{
    encoding:'utf8',timeout:20000,stdio:['ignore','pipe','pipe'],
  }));
  const escaped = encodeURIComponent(name);
  const base = 'repos/'+repository;
  const branch = get(base+'/branches/'+escaped);
  const rules = get(base+'/rules/branches/'+escaped+'?per_page=100','--paginate','--slurp').flat();
  const rulesets = Object.fromEntries([...new Set(rules.map(rule=>rule.ruleset_id))].map(id=>
    [id,get(base+'/rulesets/'+Number(id)+'?includes_parents=true')]));
  return {branch,rules,rulesets};
}

function main([repository,production,drill,writer,verifier,context,...extra]) {
  if (!/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/.test(repository ?? '') || !production || !drill || production===drill ||
      [production,drill].includes('main') || !/^\d+$/.test(writer ?? '') || !/^\d+$/.test(verifier ?? '') ||
      Number(writer)===Number(verifier) || !context || extra.length)
    throw new Error('用法：node scripts/audit-deletion-ledger-rules.mjs OWNER/REPO 正式账本分支 演练分支 写入应用ID 验证应用ID 检查名称');
  const roles = {writer:Number(writer),verifier:Number(verifier),context};
  const selected = inspectLedgerBranch(branchEvidence(repository,production),roles);
  const exercise = inspectLedgerBranch(branchEvidence(repository,drill),roles);
  const sameRules = encode(selected.rules) === encode(exercise.rules);
  console.log(JSON.stringify({repository,production:{branch:production,...selected},drill:{branch:drill,...exercise},sameRules},null,2));
  if (selected.errors.length || exercise.errors.length || !sameRules) process.exitCode=1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main(process.argv.slice(2));
