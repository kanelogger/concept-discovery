# Concept Discovery PRD v0.1

版本：v0.2
日期：2026-09-23  
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

最快 MVP：

> 基于 Skillbox 进行改造。

原因：

Skillbox 已经具备：

- Web 管理端
- Library
- CRUD
- Markdown / File Editor
- Revision
- Search
- CLI
- MCP
- Recommendation
- Usage Reporting
- Local / Self-hosted

第一阶段不重写这些系统能力。

目标是：

> 借 Skillbox 的壳，验证 Concept Discovery。

# 6. 改造原则

第一阶段避免大规模底层重构。

内部可以继续保留部分 `skill` 命名，例如：

```text
skill
skill_id
skill_revision
```

前端与产品层统一展示为：

```text
Concept
```

等产品验证后，再决定是否彻底重构领域模型。

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

Not Useful 不在首屏按钮中：用户点击 View 查看详情后，才可在详情或卡片二级操作处标记（事件语义见 §30）。

# 11. Concept 配图

MVP 支持用户直接上传 WebP。

要求：

- 格式：`.webp`
- 单图建议 ≤ 2MB
- 支持上传
- 支持替换
- 支持删除
- 支持预览
- 无图时显示默认占位图

建议路径：

```text
/uploads/concepts/{concept-id}.webp
```

`{concept-id}` 即 Concept 的 `id`（slug 规则见 §12），示例中的 `occams-razor` 就是 id 本身。

字段：

```yaml
cover_image: /uploads/concepts/occams-razor.webp
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
name: 奥卡姆剃刀

aliases:
  - Occam's Razor

description: >
  在解释力相近时，优先选择更简单的解释。

cover_image: /uploads/concepts/occams-razor.webp

status: core

interaction_type: operator
epistemic_type: principle

domains:
  - reasoning
  - communication

intents:
  - simplify
  - reduce-complexity

trigger:
  - 回答冗余
  - 方案过度设计
  - 存在大量非必要假设

avoid_when:
  - 简化会删除关键约束
  - 复杂性本身就是问题重点

transform:
  - 删除无贡献复杂度
  - 提高信息密度

agent_instruction: >
  删除对核心结论没有贡献的假设、步骤和重复信息；
  保留关键事实、证据和必要因果链。

source:
  title: ""
  url: ""
  note: ""

tags:
  - 表达
  - 解释

version: 1
```

字段约定：

- `id`：创建时确定的 slug（小写字母、数字、连字符），创建后不可变；Relation 与配图均按 `id` 引用。
- `tags`：自由标签，与受控的 `domains` / `intents` 并列，供列表筛选与卡片展示。
- `version`：从 1 开始，每次内容修订递增；Recommendation Log 记录推荐发生时的 `concept_version`（见 §31）。

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

关系独立于 tags。

数据结构：

```text
concept_relations

id
source_concept_id
target_concept_id
relation_type
note
```

`weight` 不进入 MVP：Relation Boost 使用固定常量（见 §18），差异化权重留待真实推荐数据支持后再引入。

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

说明：

> 沉没成本帮助排除无法收回的历史投入，机会成本帮助比较从现在开始的未来选择。

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

Relation 可作为轻量 rerank 信号。

例如：

```text
沉没成本
score = 0.94

机会成本
base score = 0.71
relation boost = +0.08
final score = 0.79
```

MVP 中 `relation boost` 为固定常量（示例取 +0.08），不逐对校准，只作为同分时倾向已验证组合的 tiebreaker。

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

MVP 可以暂缓 Recipe，只预留数据结构。

# 20. 搜索与推荐

必须明确拆成两个能力。

## Search

解决：

> 我知道自己要找什么。

```text
search_concepts(query)
```

## Recommend

解决：

> 我不知道自己需要什么。

```text
recommend_concepts(context)
```

这是产品核心。

# 21. Recommendation 输入

```json
{
  "task": "...",
  "context": "...",
  "response": "...",
  "user_intent": "...",
  "limit": 3
}
```

`user_intent` 为可选显式输入，与后端从上下文推断的 Intent（见 §25）相互印证，不强制一致；推荐以系统推断为准。

# 22. Recommendation 输出

```json
{
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

空推荐的机器表示为 `{"recommendations": []}`；`NONE` 只是展示层与文档标签，不进入 API 输出。

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

给 LLM 的紧凑卡片包含：`id` / `name` / 一句话 `description` / `interaction_type` / `epistemic_type` / `domains` / `intents` / `trigger` / `avoid_when`；不含配图与 `agent_instruction` 全文。

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

# 27. Web 页面

MVP 只做 4 个核心页面。

## 27.1 Concepts

- Card Grid
- Search
- Filter
- Tag
- Domain
- Create
- Edit
- Archive / Delete

## 27.2 Concept Detail

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
- Source
- Related Concepts
- Version

操作：

- Edit
- Replace Image
- Archive
- Delete

## 27.3 Concept Editor

表单：

- Name
- Description
- Cover WebP
- Aliases
- Type
- Domain
- Tags
- Intents
- Trigger
- Avoid When
- Transform
- Agent Instruction
- Source
- Relations

支持：

- Create
- Update
- Preview
- Save

## 27.4 Recommendation Playground

这是 MVP 最重要页面。

输入：

```text
Task
Context
Agent Response
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
- 编辑字段
- 修改图片
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
3. 调 recommend_concepts
4. 空推荐（recommendations: []）→ 正常继续
5. 有推荐 → 展示 1~3 个 Concept
6. 用户 Apply → get concept → compose prompt
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
  "event": "applied",
  "source": "skill",
  "timestamp": "..."
}
```

`source` 取 `skill`（真实使用）或 `playground`（调试），Eval 默认只统计 `skill` 来源。

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
奥卡姆剃刀
```

多推荐是否合格见规则 4（必须互补）；本例中"知识蒸馏"与"奥卡姆剃刀"高度重叠，单独命中奥卡姆剃刀即可，同时输出第二个需理由说明互补作用。

输入：

> 已经做这个项目半年了，现在停掉感觉很浪费。

Expected：

```text
沉没成本
机会成本
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
- Hit = 输出名单与 Expected 的交集；Top-1 Hit Rate 看首个推荐，Precision 看整组推荐。
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

名单来自 [清洗稿](../docs/method-registry-curated-v0.1.md) 的 30 个候选，全部须通过准入审查（准入门槛与逐条审核记录见产品契约）后才能导入；"知识蒸馏"等归类存疑项在准入时重定归属或暂缓。数量目标不替代质量验收。

# 34. MVP 实施顺序

## P0：Fork Skillbox

目标：

跑起来。

不改架构。

同时确认并记录：Skillbox 现有存储引擎、LLM 调用方式、上下文与回答的数据流边界（是否离开本机），结论写入 ADR（见 §40）。

## P1：Concept 化

加入：

- Concept Card
- Title
- Description
- WebP Cover
- Type
- Trigger
- Instruction

导入通过准入审查的 20~30 个 Concept（准入见 §33）。

## P2：Web CRUD

确认：

- Create
- Read
- Update
- Archive / Delete
- Upload WebP
- Relation Editing

## P3：Recommendation

改造：

```text
recommend_skills
```

为：

```text
recommend_concepts
```

优先改 Prompt 与输出 Schema。

## P4：Recommendation Playground

这是第一阶段最重要产品页。

## P5：Concept Relation

支持：

- 手动添加
- 5 种关系
- Detail 展示
- Relation Note
- Recommendation Boost

## P6：Concept Discovery Skill

Agent 接入。

## P7：Feedback + Eval

开始真实使用。

# 35. MVP Gate

达到：

```text
30 个 Core Concepts
+
50 个 Eval Cases
+
100 次真实推荐
```

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

原则：

> 能沿用 Skillbox 的就沿用。

存储沿用 Skillbox 现状，MVP 不引入新的数据库引擎；P0 确认具体引擎并记录（见 §34）。

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

以下问题在 MVP Gate 前必须给出决定，但不阻塞 P0–P2：

- Eval 数值门槛（Top-1 Hit Rate、Precision、Apply Rate 等的通过线）与判定协议的执行细节。
- LLM 提供方与数据流：推荐引擎所需的模型在本地还是远端，context / response 是否离开本机。
- 存储引擎：P0 Fork 后确认 Skillbox 现状并记录 ADR。
- `confidence` 是否及如何校准：依赖 100 次真实推荐的数据。
- 清洗稿 `type` 字段到 `interaction_type` / `epistemic_type` 双字段的导入映射。
- Recipe 数据结构：MVP 暂缓，预留字段未定。
