# 0040：运行 MVP 离线评测并整理验收包

Status: needs-info

实施记录：2026-09-25 在独立 `codex/concept-mvp-demo` 工作区启动；前置 0039 已以 `55a2d5b` 提交。用户提供的 80 条双语目录已按明确映射和占位清理报告导入新隔离库；50 条新增 Eval 草案均标记 synthetic。维护者人工标注、正式 Eval 与 100 次真实主动调用仍缺，扩大范围 Gate 未达。

**What to build:** 运行已标注的双语 Eval、完整本地路径和项目检查，汇总 0023–0029、0031–0040 的逐票提交、验收证据、已知限制与用户操作步骤。

**Blocked by:** [0039：Skill 反馈与 Usage](0039-skill-feedback-usage.md).

## Acceptance criteria

- [ ] Eval 案例有维护者标注的 Expected、`locale` 与来源；报告命中、精准、NONE 与过推结果，不把合成数据算作真实使用。
- [ ] 从本地服务到 Skill 推荐、用户选择、Prompt 执行、反馈 Dashboard 的双语路径和无模型分支可复现；`npm run check`、构建和产品验收通过。
- [x] 汇总有限范围 `0023–0029 + 0031–0040` 的逐票提交、通过/未运行检查、未决问题、风险和最终用户验收步骤；工作树可审查，不合并或部署。
- [x] PRD 的 30 个双语齐备 Concept、50 条人工案例、100 次真实主动调用及数值通过线属于扩大范围前的 Gate；缺少时明确标未达，不伪造为本轮代码通过。

## 已完成的独立准备与证据

- [验收交接包](../docs/acceptance/mvp-handoff-2026-09-25.md)汇总固定票号范围、0023–0039 的独立提交、检查结果、真实/合成数据边界、Gate 缺口与用户验收步骤；未合并或部署。
- `maintainer` 数据集现在强制每条案例具备 `source.kind` 和不含原文的 `source.ref`；评测报告保留来源标识。`node --test tests/eval-harness.test.mjs tests/skill-flow.test.mjs`：8/8 通过，覆盖来源格式与中文/英文 API → 选择 → Compose → 模拟 Agent 成果 → 反馈 Dashboard。自动化不能代替真实用户评判回答是否确实用了 Prompt。
- 以独立 `/private/tmp/concept-mvp-gate-smoke.sqlite` 和端口 4180 运行实际 `npm start`：Web `/` 与 `/api/dashboard` HTTP 200；未配置模型的 Skill 返回 `model_unavailable` 和配置提示；前后 Usage run/event 为 0。服务已关闭，隔离数据库已清理。
- `npm run doctor`、`npm run check`（64/64、75 个 Markdown 文件）、`npm run demo:build`、`git diff --check` 通过（2026-09-25）。本轮未运行 50 条维护者案例的 Eval，未验证真实应用率或数值通过线。
- 后续审查修正评测追溯：报告固定记录推荐响应时的 `concept_version`，每条案例重新读取 Registry；推荐与读取之间的版本变化令 `card_locale_match` 为 false，避免把后来编辑的版本误写成推荐版本。`node --test tests/eval-harness.test.mjs`：8/8 通过（含案例间和案例内编辑模拟）。
- [知识清单审计及导入更新](../docs/acceptance/knowledge-list-audit-2026-09-25.md)与[已填写的映射工作表](../docs/acceptance/knowledge-list-mapping-worksheet-2026-09-25.md)：扩充受控词表保留全部来源分类；原始 SHA-256 `619abeaf8811cfeacea504fe63523fae32c42d58df39d48ed5d6d3c85f1b131e`，只清空 22 条中的 43 个明确占位出处语言字段。正常 Registry 写入新库 80/80 成功；重启后 active 80、中文可推荐 59、英文 58、双语均可推荐 58、真实 Usage 0。每条版本 1 且恰有一条创建修订。无图默认配图已落实；14 个其余出处说明仍需核实。
- 分类代码实现提交 `5f942ff`、导入与 Eval 草案提交 `4645a1c`。导入脚本拒绝覆盖已存在的数据库，测试涵盖字段核对与未经报告的变更；`npm run check` 67/67 通过。50 条 [synthetic 草案](../eval/cases.draft.synthetic.json)的结构、语言分布、NONE 和 Expected ID 资格均已校验；[人工复核表](../docs/acceptance/eval-draft-review-2026-09-25.md)待维护者填写，当前人工复核 0、真实日志 0。初始数值线已在模型评测前冻结于 [thresholds.initial.json](../eval/thresholds.initial.json)，属本次委托下制定的工程线，尚未经真实样本校准。

## 缺失资源和判定

现有 50 条新增案例均为 synthetic，不能改标签冒充真实日志。维护者需逐条审核 Expected 和来源，加入 25 条匿名真实任务，形成满足 [评测契约](../specs/eval-harness.md)的至少 50 条正式案例；随后用已冻结数值线运行正式 API Eval，并人工复核诊断、Why Now 与多 Concept 覆盖。目录的 58 条双语机械资格满足 30 条数量条件，具体来源和内容质量仍需复核。100 次真实主动调用与 Apply Rate 数据尚无。正式质量验收尚未开始。

## 第一稿用户验收

2026-09-25，用户明确回复“第一稿我验收通过”，并要求从已验收版本继续原定 ticket 范围。此结论记录为第一稿产品验收通过；它未提供 50 条维护者标注案例、正式 Eval 报告或 100 次真实 Skill 调用，因此本票仍为 `needs-info`，扩大范围 Gate 仍未达。原定范围保持 `0023–0029 + 0031–0040`。同期工作区另有 0041–0043 的未提交并发修改，均不计入本票验收或提交。

同日用户进一步确认：目前没有 25 条匿名真实任务及来源，50 条草案 Expected 未逐条复核，也没有其他真实使用数据库；真实用户主动调用 Skill 的 Usage 为 0。用户要求保持本票未验收，继续完成不依赖外部材料的工作，且不能把测试或 synthetic 数据补作真实调用。

## 正式数据到位后的离线判定准备

新增 [离线数值判定器](../eval/assess-offline.mjs)及 `npm run eval:assess`：要求正式 maintainer 数据集与逐条人工复核声明相绑定，核对不同来源编号的配比、双语/NONE 数量、报告完整性、单一模型和目录版本一致性，重新计算总体与分语言指标及 NONE Recall，对照已冻结的初始通过线。结果明确区分 `not_evaluable`、`numeric_failed`、`numeric_passed`；即使数值通过，诊断和 Why Now 的内容仍须人工审查，真实 Usage 仍单独判定。`node --test tests/eval-acceptance.test.mjs` 5/5 通过；当前共享工作树 `npm run check` 73/73、`npm run demo:build`、`git diff --check` 通过，但该全量结果包含未提交的 0041–0043 并发变更，不作为这些票据的验收结论。
