# Prompt Composer 契约（0037）

依据 PRD §26（历史文件 `docs/method-system-prd-v0.1.md`，见下方来源说明），Composer 在用户于 Skill 中明确选择 Apply 后运行。0037 提供 `composePrompt(input, registry)` 服务端模块；0038 负责调用和实际应用。Web 不调用此模块，不提供 HTTP Compose 接口，也不展示 Prompt。

输入为 `{ concept_id, locale, task, context?, response? }`。`locale` 必须显式为 `cn` 或 `en`，`task` 为保留原文的非空字符串，`context`、`response` 可缺省为空串。未知字段和非文本值被拒绝。模块每次从当前 Registry 读取最新 Concept；不存在返回 `not_found`，归档或所选语言不可推荐返回 `concept_not_recommendable`。只读取所选语言的名称、`agent_instruction`、`transform`、`avoid_when`，不借用另一语言。

输出为 `{ concept_id, concept_version, locale, prompt }`。Prompt 使用所选语言的固定框架，要求先检查避免条件，并说明 Concept 如何改变任务处理方式。任务、上下文与当前回复作为 JSON 数据块插入，值可按 JSON 解析还原原文；数据中的伪造指令不能改变 Composer 顶层结构。此边界不等于对后续语言模型行为的安全保证，0038 应保留用户确认的应用步骤。Registry 不持久化完整 Prompt。

> 历史来源说明：旧产品材料已在 0045 合并删除；原文恢复方式见[文档收敛决策](../docs/adr/0004-product-doc-consolidation.md)。本文保留当时的任务或接口记录，不作为当前产品路线图。
