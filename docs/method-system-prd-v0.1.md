# Concept Discovery PRD v0.5

版本：v0.5
日期：2026-09-24

状态：MVP 范围冻结（产品未实现）

# 1. 产品定义

Concept Discovery 是一个基于上下文的概念发现系统。

它帮助用户从当前的问题、表达、分析、决策或 Agent 输出中，发现那些自己尚未想到、但已经存在的理论、模型、原则、偏差、框架和认知工具。

核心价值：

> 发现你不知道自己需要的概念。

英文描述：

> Discover the concepts you didn't know you needed.

# 2. 核心问题

传统知识库、搜索和 Prompt Library 都要求用户已经知道自己应该搜索什么。

Concept Discovery 解决的是：

> 用户不知道该搜索什么，也不知道某个已有 Concept 已经存在。

典型场景：

- 回答太啰嗦，但用户没想到“奥卡姆剃刀”。
- 分析只看到直接影响，但用户没想到“第二层思维”。
- 已经投入项目很久，难以下决定，但没有主动想到“沉没成本”“机会成本”。
- 分析停留在新闻事件，但用户没想到“事件—局势—结构”。
- Review 只寻找支持证据，但没有想到“可证伪性”“确认偏见”“逆向思维”。

# 3. 核心闭环

```text
当前问题 / 上下文 / Agent 输出
            ↓
        Diagnose
            ↓
    Recommend 0~3 Concepts
            ↓
      Discovery Card
            ↓
      Learn / Apply
            ↓
        Feedback
            ↓
          Eval
```

# 4. MVP 核心目标

MVP 只验证一个问题：

> 系统能否在正确的上下文里，推荐出一个用户原本没有想到、但看到后觉得有帮助的 Concept？

北极星时刻：

> “对，这个概念我刚才确实没想到。”

更进一步：

> “原来这个东西有名字。”

# 5. MVP 技术路线

MVP 以 Skillbox 为参考实现，在本项目中建设 Concept Discovery。当前工作区的参考源码位于 `docs/private-project/skillbox`，不以 Fork Skillbox 作为实施步骤。

优先研究并复用其成熟能力的设计与接口边界：

- Web 管理端
- Concept CRUD 与编辑流程
- Revision
- Search
- Recommend
- Usage Reporting

对每项能力按 Concept 数据模型和本地单用户场景适配；是否移植具体代码由实施任务评估。Skillbox 的 Bun、PostgreSQL、Docker 部署与通用 Skill 权限模型不自动成为本项目的技术选型。

目标是在保留这些能力经验的同时，尽快验证 Concept 推荐与应用闭环。

# 6. 改造原则

第一阶段先建立 Concept Registry 与所需能力，避免移入与 MVP 无关的上游权限、发布和部署功能。

参考 Skillbox 的模块时，可以在适配层保留上游 `skill` 命名，例如：

```text
skill
skill_id
skill_revision
```

本项目的领域接口、数据模型和前端统一使用：

```text
Concept
```

上游命名不进入新的 Concept 契约。模块复用需单独记录边界和迁移成本。

# 7. 产品组成

Web、Skill 与后续 CLI 读写同一份 Concept Registry；Registry 是唯一事实源，推荐、编辑与导入不在各自的副本中分叉。

## 7.1 Local Web System

面向人。

主要职责：

- 浏览 Concept
- 管理 Concept
- 创建 / 编辑 / 删除 / 归档
- 上传配图
- 搜索
- 查看关联 Concept
- 测试推荐
- 查看推荐记录

## 7.2 Concept Discovery Skill

面向 Agent。

工作流：

1. 获取当前 task / context / response
2. 调用 recommend
3. 获得 0~3 个 Concept
4. 向用户展示 Concept
5. 用户选择后获取详情
6. 将 Concept 应用到当前任务
7. 上报 usage / feedback

Skill 保持薄，业务逻辑放在 System。

# 8. Web 产品原则

Web 端面向人，因此采用：

> Card First

Concept 浏览与推荐都以卡片为正式展示形式；卡片包含标题、描述、WebP 配图（无图时用占位图）、标签和类型。Web 提供 `cn` / `en` 切换，默认 `cn`；界面文案、Concept 内容和配图使用同一语言。

不同页面承担不同职责：

- 浏览 / 发现：卡片
- 管理 / 编辑：列表 + 表单
- 详情：Hero Card + 模块化信息块

# 9. Concept Card

基础卡片：

```text
┌────────────────────────────┐
│          Cover             │
├────────────────────────────┤
│ 奥卡姆剃刀                 │
│                            │
│ 在解释力相近时，优先选择   │
│ 更简单的解释。             │
│                            │
│ principle · reasoning      │
└────────────────────────────┘
```

字段：

- 配图
- 标题
- 一句话描述
- 类型
- 标签

标题、描述、配图与标签按当前 `locale` 从 `locales.cn` 或 `locales.en` 读取；类型为共用枚举，展示标签按界面语言翻译。

# 10. Recommendation Card

推荐卡是产品最重要的 UI。

```text
┌────────────────────────────┐
│          Cover             │
├────────────────────────────┤
│ 奥卡姆剃刀                 │
│                            │
│ 在解释力相近时，优先选择   │
│ 更简单的解释。             │
│                            │
│ 为什么现在推荐             │
│ 当前回答存在较多对结论     │
│ 没有贡献的信息。           │
│                            │
│ [应用] [查看] [忽略]       │
└────────────────────────────┘
```

必须包含：

- Concept Name
- Description
- Cover
- Why Now
- Confidence
- Apply
- View
- Ignore

推荐卡的 Concept 文案、配图与 Why Now 使用同一 `locale`，不混用另一种语言的图片或文案。

Not Useful 不在首屏按钮中：用户点击 View 查看详情后，才可在详情或卡片二级操作处标记（事件语义见 §30）。

# 11. Concept 配图

MVP 支持为同一 Concept 分别上传 `cn` 与 `en` WebP。

要求：

- 格式：`.webp`
- 单图建议 ≤ 2MB
- 两种语言分别上传、替换、删除
- 支持预览
- 编辑草稿无某语言图片时，该语言显示默认占位图；正式可推荐 Concept 需要两种语言的图片

正式可推荐 Concept 删除任一语言图片前须先替换，或退出推荐池；不能在该语言继续展示另一语言的图片。

建议路径：

```text
/uploads/concepts/{concept-id}/cn.webp
/uploads/concepts/{concept-id}/en.webp
```

`{concept-id}` 即 Concept 的 `id`（slug 规则见 §12）；同一 Concept 的两张图片有独立路径与修订记录。

字段：

```yaml
locales:
  cn:
    cover_image: /uploads/concepts/occams-razor/cn.webp
  en:
    cover_image: /uploads/concepts/occams-razor/en.webp
```

MVP 不做：

- AI 自动生成图片
- 图片 Prompt
- 图床
- CDN
- 多尺寸媒体处理

# 12. Concept 数据模型

```yaml
id: occams-razor
status: core
interaction_type: operator
epistemic_type: principle
domains:
  - reasoning
  - communication
intents:
  - simplify
  - reduce-complexity
version: 1

locales:
  cn:
    name: 奥卡姆剃刀
    aliases: [奥卡姆原则]
    description: 在解释力相近时，优先选择更简单的解释。
    cover_image: /uploads/concepts/occams-razor/cn.webp
    wiki_url: https://example.org/wiki/cn/occams-razor
    tags: [表达, 解释]
    trigger: [回答冗余, 方案过度设计]
    avoid_when: [简化会删除关键约束]
    transform: [删除无贡献复杂度, 提高信息密度]
    agent_instruction: >
      删除对核心结论没有贡献的假设、步骤和重复信息；
      保留关键事实、证据和必要因果链。
    source:
      title: ""
      url: ""
      note: ""
  en:
    name: Occam's Razor
    aliases: [Ockham's Razor]
    description: Prefer the simpler explanation when explanatory power is comparable.
    cover_image: /uploads/concepts/occams-razor/en.webp
    wiki_url: https://example.org/wiki/en/occams-razor
    tags: [communication, explanation]
    trigger: [An answer is verbose, A solution is overengineered]
    avoid_when: [Simplification would remove a critical constraint]
    transform: [Remove unnecessary complexity, Increase information density]
    agent_instruction: >
      Remove assumptions, steps, and repetition that do not support the main conclusion.
      Keep essential facts, evidence, and causal links.
    source:
      title: ""
      url: ""
      note: ""
```

字段约定：

- `id`：创建时确定的 slug（小写字母、数字、连字符），创建后不可变；Relation 与配图均按 `id` 引用。
- `locales.cn` / `locales.en`：同一 Concept 下独立保存名称、别名、描述、WebP 配图、Wiki 链接、自由标签、Trigger、Avoid When、Transform、Agent Instruction 与 Source。Search、卡片、详情和 Prompt Composer 按请求语言取同一组字段。
- `wiki_url`：每种语言可选填一个公开可访问的 Wiki 页面 HTTPS 链接，供用户在详情页继续阅读；示例中的 `example.org` 仅演示字段结构，正式数据须使用真实链接。`source.url` 用于记录内容依据，两者用途独立。保存时校验绝对 HTTPS URL；某语言未填写时隐藏该语言的 Wiki 入口，不使用另一语言的链接，也不影响进入推荐池。
- `domains` / `intents`、`interaction_type` / `epistemic_type` 与 `id` 是跨语言共用的稳定值；`tags` 是每种语言自己的自由展示与筛选标签，不要求两组字符串相同。
- 草稿可暂缺某种语言；进入正式推荐池前，两种语言的必填文案和 WebP 配图都须通过校验。正式条目失去必填内容时须先退出推荐池；缺失语言不得静默回退到另一种语言。具体必填字段与迁移规则由 Schema 任务定稿。
- `version`：从 1 开始，任一语言的内容、Wiki 链接或配图修订都递增；Recommendation Log 记录推荐发生时的 `concept_version`（见 §31）。

# 13. Concept 类型

## 13.1 interaction_type

描述 Agent 如何使用它：

```text
operator
lens
procedure
```

- `operator`：直接作用于当前思考的算子，改写或裁剪推理过程。
- `lens`：观察偏差与盲区的透镜，用于识别当前判断的扭曲。
- `procedure`：按步骤执行的结构化流程。

operator：
- 第一性原理
- 第二层思维
- 奥卡姆剃刀
- 逆向思维

lens：
- 确认偏见
- 幸存者偏差
- 沉没成本
- 古德哈特定律

procedure：
- 决策树
- 六顶思考帽
- 循证实践

## 13.2 epistemic_type

描述 Concept 本身是什么：

```text
formal_model
empirical_finding
heuristic
principle
framework
law
bias
```

- `formal_model`：有严格数学或逻辑形式的模型。
- `empirical_finding`：来自实验或观察的稳定发现。
- `heuristic`：经验法则，不保证最优但通常有效。
- `principle`：指导性原则。
- `framework`：组织思考的多组件框架。
- `law`：以定律形式表述的规律。
- `bias`：系统性认知偏差。

# 14. Concept Relation

Concept 之间允许建立关系。

关系独立于 tags，也不承担 Recipe 的组合语义。

数据结构：

```text
concept_relations

id
source_concept_id
target_concept_id
relation_type
note:
  cn: string
  en: string
```

关系的 Concept ID 和 `relation_type` 跨语言共用；面向用户的 Relation Note 分别保存 `cn` / `en` 文案。

`weight` 不进入 MVP：Relation 在推荐中仅作为同分时的辅助排序信号（见 §18），差异化权重留待真实推荐数据支持后再引入。

MVP 支持：

```text
related_to
often_used_with
contrasts_with
extends
part_of
```

# 15. Relation 示例

```text
沉没成本
  often_used_with → 机会成本
```

说明按语言保存：

```yaml
note:
  cn: 沉没成本帮助排除无法收回的历史投入，机会成本帮助比较从现在开始的未来选择。
  en: Sunk costs set aside unrecoverable past investment; opportunity costs compare future alternatives.
```

```text
确认偏见
  related_to → 回音室效应
```

# 16. Relation 展示

列表页保持卡片干净，不展示复杂关系。

详情页展示：

```text
相关概念

[机会成本]
经常一起使用

[决策树]
相关概念
```

每条 Relation 可以展示：

- Relation Type
- Target Concept
- Relation Note

Target Concept 名称和 Relation Note 均按当前 `locale` 展示；关系类型为共用枚举，显示名称由界面翻译。

# 17. Relation 存储规则

关系只存一条。

例如：

```text
A related_to B
```

不重复存：

```text
B related_to A
```

查询时同时查 source / target。

`extends` / `part_of` 有方向，展示时按存储方向解释（A extends B ≠ B extends A）；`related_to` / `often_used_with` / `contrasts_with` 按对称关系展示，同样只存一条。

# 18. Relation 与 Recommendation

Relation 可作为轻量排序信号。先检查候选本身是否适用、是否触发 `avoid_when`，再用 Relation 处理同分且互补的候选。

例如：

```text
沉没成本已入选
机会成本与另一候选同分
机会成本 often_used_with 沉没成本
互补检查通过 → 机会成本优先
```

MVP 不为 Relation 叠加数值分数；只有同分、互补且均适用时才用于排序。

MVP 不做复杂图推理。

# 19. Recipe

Recipe 与 Relation 分开。

Relation：

```text
Concept ↔ Concept
```

Recipe：

```text
多个 Concept 构成一个应用组合
```

例如：

```text
Deep Review
├── 逆向思维
├── 可证伪性
├── 确认偏见
└── 第二层思维
```

MVP 暂缓 Recipe；Relation 的存储、编辑和展示不依赖 Recipe 数据结构。

# 20. 搜索与推荐

必须明确拆成两个能力。

## Search

解决：

> 我知道自己要找什么。

```text
search_concepts(query, locale)
```

搜索当前语言的名称、别名、描述和标签；Concept ID 与受控字段可作为跨语言过滤条件。`locale` 只接受 `cn` 或 `en`。

## Recommend

解决：

> 我不知道自己需要什么。

```text
recommend_concepts(context, locale)
```

这是产品核心。

# 21. Recommendation 输入

```json
{
  "task": "...",
  "context": "...",
  "response": "...",
  "user_intent": "...",
  "locale": "cn",
  "limit": 3
}
```

`user_intent` 为可选显式输入，与后端从上下文推断的 Intent（见 §25）相互印证，不强制一致；推荐以系统推断为准。

`locale` 为显式输入，取 `cn` 或 `en`；Web 默认传 `cn`，切换后传 `en`，Skill 按当前用户语言传值。不依据输入文本自动猜测语言。

# 22. Recommendation 输出

```json
{
  "locale": "cn",
  "diagnosis": [
    "当前判断受过去投入影响",
    "缺少未来替代方案比较"
  ],
  "recommendations": [
    {
      "id": "sunk-cost",
      "name": "沉没成本",
      "reason": "当前判断混入了无法收回的历史投入",
      "confidence": 0.94
    },
    {
      "id": "opportunity-cost",
      "name": "机会成本",
      "reason": "当前还缺少其他未来选择的价值比较",
      "confidence": 0.81
    }
  ]
}
```

字段约定：

- `reason` 即 Recommendation Card 上的 Why Now（见 §10），二者是同一内容的机器表示与展示文案。
- `diagnosis` 是自由文本，描述当前上下文缺失或被扭曲的认知视角；不要求与 `recommendations` 一一对应，但每条 `reason` 应能追溯到 `diagnosis` 描述的某个视角。
- `confidence` 是推荐器自评的 0~1 分数，表示"该 Concept 对当前上下文有实际帮助"的可能性；MVP 仅用于排序与展示，不做校准。
- 输出回显 `locale`；`diagnosis`、`name`、`reason` 使用该语言，卡片的描述、标签和配图从同一语言的 Concept 字段读取。概念 ID 与类型不翻译。

空推荐时 `recommendations` 为 `[]`，输出仍回显 `locale`；`NONE` 只是展示层与文档标签，不进入 API 输出。

# 23. 推荐规则

1. 允许 NONE
2. 默认推荐 1 个
3. 最多推荐 3 个
4. 多个 Concept 只有互补时才共同推荐
5. 不因为关键词相同就推荐
6. 必须解释 Why Now
7. 必须考虑 avoid_when
8. 避免高度重叠 Concept 同时出现
9. 优先补当前上下文缺失的认知视角
10. 禁止为了显得聪明而强行推荐
11. 同一会话内已推荐过或被忽略的 Concept 不重复推荐，除非用户主动请求
12. 连续多次空推荐或忽略后降低主动触发频率，避免噪声

# 24. 推荐流程

```text
Task
Context
Response
   ↓
Diagnosis
   ↓
Intent
   ↓
Concept Candidates
   ↓
LLM Rank
   ↓
NONE / Top 1~3
```

初始 20~50 个 Concept 时，不需要：

- Vector DB
- Embedding Pipeline
- Complex Retrieval

直接使用紧凑 Concept Cards + LLM Router。

给 LLM 的紧凑卡片包含：`id` / 请求语言的 `name`、一句话 `description`、`trigger`、`avoid_when` / 共用的 `interaction_type`、`epistemic_type`、`domains`、`intents`；不含配图与 `agent_instruction` 全文。

LLM Router 需要调用大模型；上下文与回答是否离开本机取决于所选模型提供方，这是 P0 决策项（见 §34、§40）。

# 25. Intent

中间层：

```text
Context
  ↓
Intent
  ↓
Concept
```

初始 Intent：

```text
simplify
challenge_assumption
find_counterexample
explore_consequences
compare_options
detect_bias
broaden_perspective
analyze_risk
analyze_structure
clarify_explanation
validate_evidence
escape_stuck_thinking
```

MVP 中 Intent 可只存在于后端。

# 26. Prompt Composer

用户点击 Apply 后：

```text
Concept
+
Current Task
+
Current Context
+
Current Response
```

生成：

```text
Contextual Prompt
```

同一个 Concept 在不同任务中生成不同 Prompt。

不在 Registry 中保存一份固定完整 Prompt。

Composer 使用所选 `locale` 的 `agent_instruction`、`transform` 和 `avoid_when`，生成同语言的 Prompt；原始 task / context / response 保留原文，不因界面切换而自动翻译。

# 27. Web 页面

MVP 只做 4 个核心页面。

## 27.1 Concepts

- `cn` / `en` 切换（界面文案、卡片内容和图片同步）
- Card Grid
- Search
- Filter
- Tag
- Domain
- Create
- Edit
- Archive / Delete

## 27.2 Concept Detail

详情页遵守当前 `locale`；类型、Domain 等共用值以当前语言的界面标签显示。

顶部 Hero：

- Cover
- Title
- Description
- Tags
- Type

正文：

- Trigger
- Avoid When
- Transform
- Agent Instruction
- Wiki 外部链接（按当前语言展示，打开外部页面）
- Source
- Related Concepts
- Version

操作：

- Edit
- Replace Image
- Archive
- Delete

## 27.3 Concept Editor

表单把跨语言共用字段与 `cn` / `en` 内容分区；两个语言区分别编辑和预览：

- Name
- Description
- Cover WebP（`cn` / `en` 分别上传）
- Aliases
- Type
- Domain
- Tags
- Intents
- Trigger
- Avoid When
- Transform
- Agent Instruction
- Wiki URL（`cn` / `en` 分别添加、修改或移除）
- Source
- Relations

支持：

- Create
- Update
- Preview
- Save

Relations 编辑在 §34 P3 接入；P1 先完成 Concept 本身的 CRUD。

草稿可分次补齐语言内容；进入正式推荐池前校验两种语言的必填文案及配图，缺失时在编辑页显示具体语言和字段。

## 27.4 Recommendation Playground

这是 MVP 最重要页面。

输入：

```text
Task
Context
Agent Response
Locale (cn / en)
```

输出 Recommendation Cards。

支持：

- Apply
- View
- Ignore
- Not Useful

Playground 与 Skill 调用同一条 recommend API；Playground 产生的事件在 Recommendation Log 中带 `source: "playground"` 标记，Eval 统计默认只计真实使用（见 §31、§32）。

# 28. CRUD

Web 端必须支持完整 Concept CRUD。

Create：
- 创建 Concept

Read：
- 卡片列表
- 搜索
- 详情

Update：
- 分别编辑 `cn` / `en` 字段
- 分别修改 `cn` / `en` 图片
- 分别编辑 `cn` / `en` Wiki URL
- 修改 Relation
- 修改 Source

Delete：
- 优先 Archive
- 支持 Hard Delete 时必须二次确认

# 29. Skill

只提供一个：

```text
concept-discovery
```

工作流：

```text
1. 判断当前任务是否值得 Concept Discovery
2. 收集 task / context / response
3. 携带 locale 调 recommend_concepts
4. 空推荐（recommendations: []）→ 正常继续
5. 有推荐 → 展示 1~3 个 Concept
6. 用户 Apply → 按 locale 获取 concept → compose prompt
7. Agent 执行
8. report usage
```

触发与冷却：

- 第 1 步是轻量前置判断，可与第 3 步合并为同一次 LLM 调用；简单任务（事实问答、格式转换等）应在此被过滤。
- 遵守 §23 规则 11、12：会话内去重与降频，由 Skill 侧维护推荐历史。

# 30. Feedback

必须区分：

```text
recommended
viewed
applied
ignored
not_useful
```

推荐不等于使用。

事件语义：

- `recommended`：系统发出推荐即记录。
- `viewed`：用户打开 Concept 详情。
- `applied`：用户点击 Apply 并用于当前任务。
- `ignored`：用户未查看即忽略推荐。
- `not_useful`：用户查看后主动标记"没有帮助"；它与 `ignored` 的区别在于经过查看，用于衡量推荐质量而非曝光质量。

`applied` 与 `ignored` / `not_useful` 互斥；`ignored` 之后仍可补充标记 `not_useful`（查看过的前提下）。

# 31. Recommendation Log

```json
{
  "task_id": "...",
  "concept_id": "occams-razor",
  "concept_version": 3,
  "locale": "cn",
  "event": "applied",
  "source": "skill",
  "timestamp": "..."
}
```

`source` 取 `skill`（真实使用）或 `playground`（调试），Eval 默认只统计 `skill` 来源。

`locale` 记录本次推荐与应用使用的语言，供双语质量分析；同一 Concept 的 ID 和修订版本跨语言共用。

用于：

- Eval
- Trigger 调优
- 推荐质量分析

# 32. Eval

Eval 从 MVP 开始建设。

核心问题：

> 该推荐的时候推荐对了吗？

> 不该推荐的时候有没有闭嘴？

示例：

输入：

> 这个回答太啰嗦，很多东西删掉也不会影响结论。

Expected：

```text
occams-razor
```

多推荐是否合格见规则 4（必须互补）；本例中"知识蒸馏"与"奥卡姆剃刀"高度重叠，单独命中奥卡姆剃刀即可，同时输出第二个需理由说明互补作用。

输入：

> 已经做这个项目半年了，现在停掉感觉很浪费。

Expected：

```text
sunk-cost
opportunity-cost
```

输入：

> 2+2 等于多少？

Expected：

```text
NONE
```

指标：

```text
Top-1 Hit Rate
Recommendation Precision
NONE Precision
Over-recommendation Rate
Apply Rate
Ignore Rate
Not Useful Rate
```

判定协议：

- 50 个 Eval Case 由维护者人工标注 Expected；场景来源为真实使用日志与典型场景各半。
- 每个 Eval Case 标明 `locale`，覆盖 `cn` / `en`；除了 Concept ID 命中，还检查诊断、Why Now、卡片字段和配图是否使用对应语言。
- Expected 使用跨语言共用的 Concept ID，显示名称由 `locale` 解析。Hit = 输出 ID 名单与 Expected ID 的交集；Top-1 Hit Rate 看首个推荐，Precision 看整组推荐。
- "用户原本没想到"是主观体验，MVP 以 Apply Rate 作为行为代理指标，不在离线 Eval 中判定。
- NONE 类用固定琐碎输入（如数学事实问答），要求输出 `recommendations: []`。
- 数值通过门槛未定，见 §40。

# 33. 初始 Concept 数量

建议：

```text
20~30 个
```

优先覆盖：

推理：
- 第一性原理
- 第二层思维
- 奥卡姆剃刀
- 逆向思维
- 可证伪性

决策：
- 沉没成本
- 机会成本
- 安全边际
- 决策树

偏差：
- 确认偏见
- 幸存者偏差
- 锚定效应
- 易得性偏差
- 基本归因错误

表达：
- 知识诅咒

结构分析：
- 事件—局势—结构

证据：
- 循证实践
- 萨根标准
- 古德哈特定律

名单来自 [清洗稿](../docs/method-registry-curated-v0.1.md) 的 30 个候选，全部须通过准入审查后才能导入；清洗稿只有中文内容，英文文案与双语配图仍需补齐和审核。准入门槛与逐条审核记录尚待定稿，缺口见[产品契约](../specs/product-contract.md#待定契约材料冲突与字段缺口)。"知识蒸馏"等归类存疑项在准入时重定归属或暂缓。数量目标不替代质量验收。

# 34. MVP 实施顺序

主线按以下五步推进。Concept Schema、Core 准入规则和首批内容审核是 CRUD/推荐的数据前置条件；应用栈、存储和模型的数据流在各能力实施前记录决定，不单设 Fork 阶段。

## P1：Concept CRUD

建立同一份 Concept Registry 与本地 Web。以 Card First 展示 Concept，支持 `cn` / `en` 标题、描述、WebP 配图与标签，类型跨语言共用；按语言搜索、创建、编辑、归档和删除，并保留内容修订记录。详情页展示该语言可选的 Wiki 外部链接，编辑器可按语言维护。优先参考 Skillbox 的 Web、CRUD、Revision 与 Search 能力。首批导入仅限通过准入审查且双语字段齐备的 Concept（见 §33）。

## P2：Recommendation Playground

实现 `recommend_concepts`、Diagnosis、Why Now、空推荐与 0~3 个推荐卡；Playground 使用正式推荐接口并显式传 `locale`。用户选择 Apply 后生成同语言的上下文化 Prompt。优先参考 Skillbox 的 Recommend 边界，但按 Concept Schema、`avoid_when` 和本产品的输出契约适配。此阶段准备覆盖两种语言的离线 Eval 案例，避免到真实使用时才首次检查推荐质量。

## P3：Concept Relation

支持手动添加五种关系、方向语义、双语 Relation Note、详情展示与轻量推荐信号。Relation 与 Recipe 分离；Recipe 不进入 MVP。

## P4：Concept Discovery Skill

接入 Agent，复用同一 Registry、推荐接口和 Prompt Composer；传递用户选择的 `locale`，用户选择后才应用 Concept。

## P5：Feedback / Eval

记录推荐、查看、应用、忽略及无帮助事件，参考 Skillbox 的 Usage Reporting 思路；区分 Playground 与真实 Skill 使用。运行离线案例和真实使用评估，再按 §35 的 Gate 决定是否扩大范围。

# 35. MVP Gate

达到：

```text
30 个 cn/en 内容与配图齐备的 Core Concepts
+
50 个标明 locale 且覆盖 cn/en 的 Eval Cases
+
100 次真实推荐
```

真实推荐记录按 `locale` 分开统计，便于判断两种语言的质量；具体样本分配与通过门槛见 §40。

之后再决定是否扩大。

只看三个问题：

1. 该推荐的时候，系统能不能想到？
2. 不该推荐的时候，系统能不能返回 NONE？
3. 用户看到后，是否经常觉得“这个确实有帮助”？

# 36. MVP 明确不做

第一版不做：

- 多用户
- 登录
- 权限体系
- Profile / Grant
- Cloud Sync
- Marketplace
- Skill Publishing
- Docker 必需
- PostgreSQL 必需
- Vector DB
- 自动知识图谱
- Neo4j
- Graph Visualization
- AI 图片生成
- 自动 Concept 抓取
- 自动 Relation 抽取
- Recommendation Personalization
- 大规模 Recipe 系统
- 完整 Revision UI 重构
- 直接 Fork Skillbox

原则：

> 优先参考 Skillbox 已验证的能力边界，再按 Concept 业务和本地运行约束适配。

本项目的存储引擎与启动方式单独选定；Skillbox 的 PostgreSQL 和 Docker 仅作为参考实现事实，不构成本产品依赖。

# 37. 后续方向

MVP 验证成功后再增加：

Discovery：
- Personalized Recommendation
- History-aware Recommendation
- Recipe Recommendation

Registry：
- Source 管理
- 完整 Revision
- Import / Export
- Git Sync

Relation：
- 自动 Relation Suggestion
- Relation Confidence
- Graph Exploration

Recommendation：
- Hybrid Search
- Embedding Recall
- LLM Rerank

Distribution：
- MCP
- Claude
- Codex
- Cursor
- OpenCode

# 38. 最终产品结构

```text
Concept Registry
      ↓
Concept Relations
      ↓
Recommendation Engine
      ↓
Discovery Card
      ↓
Learn / Apply
      ↓
Prompt Composer
      ↓
Feedback / Eval
```

Web 面向人：

> 发现、理解、管理 Concept。

Skill 面向 Agent：

> 在正确的上下文里调用 Concept Discovery。

Recommendation Engine：

> 找到用户此刻没有想到、但值得想到的 Concept。

# 39. 一句话总结

Concept Discovery 是一个会根据当前上下文，主动帮用户补全“人类已经存在的概念”的本地知识发现系统。

MVP 的核心不是做更多功能。

核心是：

> 在正确的时候，推荐正确的 Concept。

# 40. 未决问题

以下问题在 MVP Gate 前必须给出决定；其中 Schema/准入、应用栈/存储和模型数据流须在各自依赖的实施阶段前确定：

- Eval 数值门槛（Top-1 Hit Rate、Precision、Apply Rate 等的通过线）与判定协议的执行细节。
- LLM 提供方与数据流：推荐引擎所需的模型在本地还是远端，context / response 是否离开本机。
- 应用栈与存储引擎：结合本地单用户要求选择，并记录与 Skillbox 参考实现的取舍。
- `confidence` 是否及如何校准：依赖 100 次真实推荐的数据。
- 清洗稿 `type` 字段到 `interaction_type` / `epistemic_type` 双字段的导入映射。
- Recipe 数据结构：MVP 暂缓，预留字段未定。
- 双语准入细则：`cn` / `en` 的必填字段、既有中文清洗稿的英文内容核验与迁移规则，在 Schema/准入任务定稿。
