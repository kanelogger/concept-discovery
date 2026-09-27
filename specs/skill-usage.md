# Skill Usage 与 Feedback 契约（0039）

依据 PRD §30–§31（历史文件 `docs/method-system-prd-v0.1.md`，见下方来源说明），Usage 仅由用户主动调用的 Concept Discovery Skill 包装层写入。正式 `POST /api/recommendations` 和开发用 Eval 调用均不写真实 Usage。

每次 Skill 推荐成功生成匿名 `task_id` 和可关联的 `run_id`，记录语言、时间和推荐数；NONE 运行保留为零推荐的 run。每个被展示的 Concept 写一条 `recommended` 事件，保存该次接口返回的 Concept ID 与 `concept_version`。事件只保存 ID、版本、语言、时间及关联 ID，不保存原始任务、上下文、回复、Why Now、密钥或生成 Prompt。推荐后 Concept 编辑或归档不改写历史事件。

状态规则：

- `viewed` 仅在用户打开该次推荐的详情时记录；`ignored` 仅在未查看、未准备应用时记录。
- `not_useful` 需要先 `viewed`，可在曾 `ignored` 后补充，但与 `applied` 互斥。
- `compose` 只为该次被推荐且当前语言仍可推荐的 Concept 生成 Prompt，并记录准备状态和实际读取版本，不产生 `applied`。
- `applied` 需要已有准备状态，且 Agent 已用 Prompt 完成当前任务；与 `ignored`、`not_useful` 互斥。此事件记准备时的 Concept 版本。只有 Agent 的真实执行可满足最后一项，数据库只能检查先前准备与事件转移。
- 每种事件对同一 run/Concept 最多一次；无效转移返回 `invalid_usage_transition`。一条推荐 Run 可含最多三项，各项状态独立。

Dashboard 的 `usage` 返回 `runs_total`、`none_runs`、五种事件次数及 `cn`/`en` 分组。`recommended` 按 Concept 次数，NONE 按 run 次数；这些数字不是成功率或离线 Eval 指标。每个事件的语言取当次 run 语言。每条有推荐的 Skill Run 在同一写入事务中为相应 Concept 添加引用；有真实 Usage 的 Concept 可归档，但永久删除仍按 P1 引用约束拒绝，保留历史事件完整性。

> 历史来源说明：旧产品材料已在 0045 合并删除；原文恢复方式见[文档收敛决策](../docs/adr/0004-product-doc-consolidation.md)。本文保留当时的任务或接口记录，不作为当前产品路线图。
