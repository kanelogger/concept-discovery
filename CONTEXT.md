# Concept Discovery

记录本产品已明确的领域词义。待访谈确认的边界暂不写入。

## Language

**Concept**:
有明确名称和可说明出处的专业领域术语或方法论术语。
_Avoid_: Method

**Concept 目录**:
收录并供人维护 Concept 的集合；收录的条目可以尚未具备某种语言的浏览或推荐资格。
_Avoid_: 推荐池

**Concept 语言版本**:
同一 Concept 的中文或英文内容与配图；两种语言共享概念身份，内容和可用资格分别判断。
_Avoid_: 独立 Concept

**可浏览 Concept**:
在指定语言中已有名称、描述和出处文本，因而可供该语言的读者浏览与搜索的 Concept。
_Avoid_: 可推荐 Concept

**可推荐 Concept**:
在指定语言已可浏览，并具备该语言的配图、适用场景说明与 Agent 应用指引的 Concept；资格按语言判断。
_Avoid_: Core、可浏览 Concept

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
