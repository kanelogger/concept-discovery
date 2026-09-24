# 0009：审阅 Concept Discovery PRD v0.2

## 目标与范围

审阅 [PRD](../docs/method-system-prd-v0.1.md) 的内部一致性、实施前置条件与 MVP 验收可执行性；对照 [产品契约](../specs/product-contract.md)、[复用评估](../.reuse/reuse-plan.md) 和 Skillbox 上游 README。交付按影响排序的审阅意见，不直接改写产品需求。

## 验收条件

- 审阅意见引用具体段落和可核验依据，并说明对实施或验收的影响。
- 区分必须在实施前定稿的契约与可延后的优化。
- 隔离本任务文件后 `npm run validate` 通过；如工作目录受无关文件影响，记录原始失败。差异只包含本任务记录及状态。

## 工作分工与进度

- 负责人：主 Agent；本任务无并行分工。
- 进度：审阅、差异检查与隔离校验已完成。

## 决策与未决事项

- 审阅只提出修订建议；产品路线与数值门槛仍由后续任务定稿。
- 高优先级发现：
  1. PRD §5、§34 P0 直接要求 Fork Skillbox，§36 又排除 Docker/PostgreSQL 必需；[上游 README](https://github.com/kitze/skillbox#quick-start)明确 Docker-only setup，PostgreSQL 为事实源，而[复用评估](../.reuse/reuse-plan.md#复用决策reference)仍建议 reference。需先定本地部署约束及 fork 取舍，再把 Fork 写成实施前置。
  2. PRD §4 的验证目标是“用户原本没想到且有帮助”，§32 只用 Apply Rate 代理，§35 Gate 只有样本数量。采用可能来自已知概念，数量也不能判断质量；需直接采集少量新颖性和帮助性反馈，并预定 Gate 判据。
  3. PRD §30–31 的日志缺推荐实例、会话和推荐批次标识；§21 API 输入也无会话信息，§29 去重仅在 Skill 侧。重复推荐同一 Concept 时无法归因后续事件或计算可靠的采用、忽略率；空推荐同样缺日志。需定曝光单位、标识及事件状态转换。
  4. PRD §12 仅示例 `status: core`，§33 声称准入门槛与逐条记录见产品契约，然而[契约](../specs/product-contract.md#待定契约材料冲突与字段缺口)明确两者待定。P1 导入之前必须定生命周期、pack、推荐池过滤与 Core 准入规则。
  5. PRD §32 的 Hit、Precision、NONE Precision、Over-recommendation Rate 缺清晰分母和多标签判定；NONE 例只覆盖琐碎问答，Eval 安排在 P7。需在 P3 前固定含边界/禁用情形的离线样本、裁判规则和通过线，真实使用日志可后补。
- 次要发现：§22 将未校准的 `confidence` 写成帮助概率并要求卡片显示，易误导用户；§22 推荐结果不含 `concept_version`，§29 Apply 再取详情时可能取到已修改版本；§18 的固定 `+0.08` 示例与“只作同分 tiebreaker”不符。分别建议改为标明含义的排序分、固定推荐修订，以及真正的同分处理规则。

## 验证证据

| 日期 | 命令或审查 | 结果 / 退出码 | 证据及未覆盖范围 |
| --- | --- | --- | --- |
| 2026-09-24 | `npm run validate`（工作目录） | failed / 1 | 18 处错误均在被 `.gitignore` 的 `docs/private-project/`，涉及上游材料的失效锚点与缺失文件；不属于本任务更改。|
| 2026-09-24 | `git diff --cached --check` 与人工审查 | passed / 0 | 两份本任务文件无空白错误，暂存内容已审查。|
| 2026-09-24 | `npm run validate`（HEAD 导出并覆盖本任务两文件） | passed / 0 | 临时目录 `/private/tmp/concept-prd-review-GpVtdA`，30 个 Markdown 文件通过；隔离掉被忽略的私人资料，仅验证版本化仓库及本任务更改。|

## 交接

审阅意见将交付给用户。后续建议先解决 fork 部署取舍、Gate 判据与事件协议，再按 [产品待办](backlog.md)定稿 Schema 与准入规则；未修改 PRD 本文。工作目录的 `npm run validate` 仍因被忽略的私人资料失败，隔离校验通过。
