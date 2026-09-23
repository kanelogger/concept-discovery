# 0006 PRD v0.2 重写落地与契约漂移修复

## 目标与范围

PRD（docs/method-system-prd-v0.1.md）被全文重写为 v0.2 结构（章节号全部变化），导致：

- `specs/product-contract.md` 26 处、`tasks/backlog.md` 2 处 PRD 锚点失效，`npm run validate` FAIL；
- 重写引入的 PRD 内部不一致（空推荐表示、tags 字段缺口、重复名单、Confidence/Eval/Feedback 定义缺口等）未收敛。

本期交付：

1. PRD 内部不一致修复：统一空推荐机器表示、补 `tags` 与 id/version 字段约定、补类型枚举定义、修 §33 重复名单与准入前置、补 Confidence 定义、Eval 判定协议、Feedback 事件语义、触发冷却规则、Playground 与 Skill 共用 API 及 log `source` 标记、Relation 方向语义、配图路径命名、存储与数据流声明。
2. 恢复 PRD「未决问题」章节（§40），只记录不在本次静默决定的问题。
3. 修复 product-contract.md 与 backlog.md 的全部失效锚点，并按 v0.2 更新待定项状态。
4. PRD 版本号升为 v0.2，状态措辞消除「MVP Ready」歧义。文件名不重命名（契约已记录为后续 ADR 决策）。

验收边界：只改文档与锚点一致性，不生成正式 Registry、不决定契约标注为待用户/后续任务裁决的事项（Eval 数值门槛、LLM 提供方、存储引擎、Recipe 结构、`type` 导入映射）。

## 验收条件

- `npm run validate` 通过（锚点检查为本次必需检查）。
- PRD 内不再出现互相矛盾的空推荐表示、Not Useful 入口、tags 缺口、重复名单。
- product-contract.md 待定表每项的 PRD 锚点与状态描述与 v0.2 一致；不静默关闭仍属待定的契约项。
- 未决问题只收录未决定事项，已在本任务定稿的（空推荐表示、tags 字段、reason=Why Now、Relation 独立表）移出待定。

## 工作分工与进度

- Agent：docs/method-system-prd-v0.1.md、specs/product-contract.md、tasks/backlog.md、tasks/0006-prd-v02-contract-drift.md、workflow-state.json。
- 进度：已完成。PRD v0.2 一致性修复、契约与 backlog 锚点重锚、未决问题 §40 落档。

## 决策与未决事项

- 空推荐：机器表示统一为 `{"recommendations": []}`，`NONE` 仅展示标签（延续契约既有结论）。
- Relation：MVP 使用固定 boost 常量，`weight` 字段移出 MVP Schema，留待数据支持（写入 §14/§18）。
- Feedback：`applied` 与 `ignored`/`not_useful` 互斥；`ignored` 后可补充标记 `not_useful`；`not_useful` 只能在 View 后标记。
- 知识蒸馏：移出初始推荐名单（ML 术语歧义、归类存疑），准入时再定；§32 首个 Eval 例子的 Expected 收敛为奥卡姆剃刀。
- 版本号：v0.1 → v0.2；文件名 `method-system-prd-v0.1.md` 保留，重命名走后续 ADR（契约已有记录）。
- 仍待定（写入 PRD §40，不在本次决定）：Eval 数值门槛、LLM 提供方与数据流边界、存储引擎确认（P0 决策）、confidence 校准、清洗稿 `type` 双字段映射、Recipe 结构。

## 验证证据

| 日期 | 命令或审查 | 结果 / 退出码 | 证据及未覆盖范围 |
| --- | --- | --- | --- |
| 2026-09-23 | `npm run validate` | passed（退出码 0） | 修复后全量锚点检查通过；不证明内容真实性 |
| 2026-09-23 | `npm run check` | passed（25/25） | 仓库公共检查含结构一致性测试；不执行业务验收 |

## 交接

结果：PRD 升至 v0.2（状态「MVP 范围冻结（产品未实现）」）；27 处失效锚点全部修复（contract 26 + backlog 2，其中 §12 字段名行 1 处为复查补修）；PRD 新增 §40 未决问题；契约待定表按 v0.2 更新状态，已定稿项（空推荐表示、tags、reason=Why Now、Relation 独立表、双类型字段）明确标注，仍待定项（Eval 门槛、LLM 提供方、存储引擎、confidence 校准、`type` 导入映射、Recipe 结构、status/pack、准入门槛细则）保留。

下一步：按 backlog 任务 1 定稿 Schema 与准入规则；P0 时处理 §40 前三项决策并写 ADR。

清理：无临时文件。提交哈希见 Git 历史。
