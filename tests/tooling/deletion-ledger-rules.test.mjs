import assert from 'node:assert/strict';
import test from 'node:test';
import { inspectLedgerBranch } from '../../scripts/audit-deletion-ledger-rules.mjs';

const roles = {writer:41,verifier:42,context:'ledger-append-only'};
const writer = {actor_type:'Integration',actor_id:roles.writer,bypass_mode:'always'};
const types = ['deletion','non_fast_forward','required_signatures','required_linear_history'];
function fixture() {
  return {
    branch:{protected:true,commit:{sha:'a'.repeat(40)}},
    rules:[
      ...types.map(type=>({type,ruleset_id:1})),
      {type:'creation',ruleset_id:2},
      {type:'update',ruleset_id:2},
      {type:'required_status_checks',ruleset_id:1,parameters:{
        required_status_checks:[{context:roles.context,integration_id:roles.verifier}],
      }},
    ],
    rulesets:{1:{enforcement:'active',bypass_actors:[]},2:{enforcement:'active',bypass_actors:[writer]}},
  };
}

test('归一化正式与演练的规则效果时保留旁路和验证身份',()=>{
  const production = fixture(), drill = fixture();
  drill.rules.reverse();
  const first = inspectLedgerBranch(production,roles), second = inspectLedgerBranch(drill,roles);
  assert.deepEqual(first.errors,[]);
  assert.deepEqual(first.rules,second.rules);
  drill.rulesets[1].bypass_actors=[writer];
  const changed = inspectLedgerBranch(drill,roles);
  assert.notDeepEqual(first.rules,changed.rules);
  assert.ok(changed.errors.includes('缺少无旁路的保护：non_fast_forward'));
  assert.ok(changed.errors.includes('缺少由指定验证应用发布的无旁路追加检查'));
});

test('不可见的旁路权限和其他应用同名检查无法作为验收证据',()=>{
  const input = fixture();
  delete input.rulesets[2].bypass_actors;
  input.rules.at(-1).parameters.required_status_checks[0].integration_id=roles.writer;
  const {errors}=inspectLedgerBranch(input,roles);
  assert.ok(errors.some(error=>error.includes('无法核实规则')));
  assert.ok(errors.includes('分支更新没有限制为指定写入应用'));
  assert.ok(errors.includes('分支创建没有限制为指定写入应用'));
  assert.ok(errors.includes('缺少由指定验证应用发布的无旁路追加检查'));
});
