# Concept Discovery

记录本产品已明确的领域词义。待访谈确认的边界暂不写入。

## Language

**Concept**:
有明确名称和可说明出处的专业领域术语或方法论术语。
_Avoid_: Method

**可推荐 Concept**:
某语言内容已能说明适用场景并指导 Agent 用于当前任务的 Concept；资格按语言判断。
_Avoid_: Core

**Concept Relation**:
两个 Concept 之间带类型的语义关联，描述它们如何相关，不定义共同应用的步骤。
_Avoid_: Related Methods

**Recipe**:
为某类任务组合多个 Concept 的可复用应用方案。
_Avoid_: Relation

**Recommendation**:
针对当前任务提出的 Concept 建议，包含推荐理由；没有合适项时可以为空。
_Avoid_: Apply

**Apply**:
用户选择某个推荐 Concept 后，由 Agent 将它用于当前任务的行为。
_Avoid_: 查看、生成 Prompt

**Source**:
说明 Concept 名称或内容来历的出处。
_Avoid_: Wiki Link

**Wiki Link**:
供读者继续了解 Concept 的语言对应的外部 Wiki 页面。
_Avoid_: Source
