# 0036：将 Relation 用作轻量推荐排序信号

Status: done

实施记录：2026-09-25 在独立 `codex/concept-mvp-demo` 工作区启动；前置 0035 已以 `738743e` 提交。推荐输出已有模型置信度，但没有显式互补判断；本票用模型给出已选 Concept ID 的互补声明，再由 Registry 的 `often_used_with` 关系对同分结果做稳定排序，不更改推荐数量。

**What to build:** 只在候选适用、未命中 `avoid_when`、与已选项互补且同分时，用 Relation 决定推荐顺序。

**Blocked by:** [0035：Concept Relation CRUD](0035-concept-relation-crud.md).

## Acceptance criteria

- [x] `often_used_with` 等关系仅在明确的互补同分案例改变顺序，不强行增加推荐数、不给关系叠加数值权重。
- [x] 不适用、归档或触发避免条件的目标不能靠关系进入结果；`extends`/`part_of` 方向解释保持一致。
- [x] 可复现测试比较有无关系的推荐结果，并记录假模型与真实模型的验证边界；公共检查通过。

## 实施与证据

- [推荐契约](../specs/recommendation-contract.md#relation-同分排序0036)规定模型的可选 `complementary_to` 仅指向更早入选项，服务端在同分且存在已存 `often_used_with` 关系时稳定调整顺序。首项、不同置信度、推荐数量和公开字段保持不变；`extends`、`part_of` 不自动当成互补。关系读取限于当次同语言可推荐池。
- `node --test tests/recommendation-contract.test.mjs tests/recommendation-api.test.mjs`：10/10 通过（2026-09-25）。假模型通过正式 HTTP 比较无关系、有向关系、互补关系、无互补声明、不同分、排除第三项与归档第三项；无关系不会额外加入 Concept，归档目标即使被模型返回仍遭契约拒绝。互补声明错误引用在结构层被拒绝，内部字段不外露。
- `npm run check`：54/54 通过；`npm run demo:build` 与 `git diff --check` 通过。0033 曾用真实 DeepSeek 测过基础推荐，但 0036 新增的互补标注与排序未做远端模型语义验收；现有证据只证明确定性服务端排序，不能证明模型总能正确判断互补或 `avoid_when`。该语义质量留给 0040 的人工标注评测。

## 未决与下一步

真实模型对 `complementary_to` 的稳定性及禁用条件判断仍需 0040 数据验证。下一张依赖票据为 [0037 Prompt Composer](0037-contextual-prompt-composer.md)。
