# Concept Discovery PRD v0.1

版本：v0.1
日期：2026-09-23  
状态：Draft

## 0. 产品结论

Concept Discovery 是一个“基于上下文发现已有概念”的本地系统。

它解决的问题是：

> 用户知道自己正在表达、分析或判断什么，但并不知道人类已经有一个现成的理论、模型、原则、偏差或思维工具可以更准确地描述和处理这个问题。

产品通过分析当前任务、上下文和 Agent 输出，推荐 0~3 个最相关的 Concept，并允许用户进一步了解、应用或把它转成当前任务的可执行 Prompt。

核心价值不是“收藏更多理论”，而是：

> 在正确的上下文里，让用户发现自己原本不知道需要的 Concept。

一句话：

> Discover the concepts you didn't know you needed.

---

## 1. 背景与问题

用户在使用 LLM / Agent 时经常遇到以下情况：

- 知道答案太啰嗦，但不知道“奥卡姆剃刀”可以压缩这个要求。
- 感觉分析太浅，但不知道“第二层思维”可以帮助继续追问后续影响。
- 觉得分析只围绕新闻事件，但不知道“事件—局势—结构”可以扩展时间尺度。
- 已经投入项目很久，难以判断是否继续，但没有主动想到“沉没成本”“机会成本”。
- Review 只寻找支持证据，没有想到“可证伪性”“确认偏见”“逆向思维”。

传统 Prompt Library 和知识库有一个共同前提：

> 用户已经知道自己应该搜索什么。

Concept Discovery 处理的是另一类问题：

> 用户不知道应该搜索什么，也不知道某个 Concept 已经存在。

---

## 2. 产品定位

Concept Discovery 是：

**Context-aware Concept Discovery System**

核心模型：

`User × Problem × Context × Concept`

输入：

- 用户当前问题
- 当前任务上下文
- Agent 已有回答（可选）
- 用户目标（可选）

输出：

- 当前可能遗漏的认知视角
- 0~3 个推荐 Concept
- 推荐理由
- Concept 简介
- 当前场景下的作用
- 可执行 Prompt
- 应用 / 忽略 / 查看动作

---

## 3. 产品原则

### 3.1 以“发现”为核心

产品首要价值是让用户产生：

> “原来这个东西有名字。”

因此推荐结果必须显式展示 Concept，而不能只把 Concept 隐藏在 Agent 的推理中。

### 3.2 推荐优先于搜索

搜索用于：

> 我知道自己要找什么。

推荐用于：

> 我不知道自己需要什么。

两者是独立能力。

### 3.3 允许返回 NONE

没有 Concept 能明显改善当前任务时，应该返回空推荐。

推荐器不能为了显得聪明而强行塞理论。

### 3.4 默认推荐 1 个，最多 3 个

优先给一个最有增益的 Concept。

只有当多个 Concept 明显互补时，才返回 2~3 个。

### 3.5 Concept 原子化

底层 Registry 中：

- 奥卡姆剃刀
- 可证伪性
- 第一性原理
- 第二层思维
- 沉没成本
- 机会成本

都应该是独立 Concept。

组合关系通过 Intent / Recipe 建立。

### 3.6 Prompt 动态生成

Registry 存储 Concept 本身的结构化知识。

完整 Prompt 应由：

`Concept × Current Context × User Intent`

动态生成。

### 3.7 System 是唯一事实源

Concept 数据、Trigger、Source、版本、推荐日志均由 Local System 管理。

Web、CLI、Skill、未来 MCP 共用同一套 Core / Registry。

---

## 4. 目标用户

核心用户：

- 高频使用 ChatGPT / Claude / Codex / Cursor / OpenCode 等 AI 工具的人
- 需要做研究、分析、决策、Review、写作、表达的人
- 有一定知识积累，但无法随时想起所有理论和模型的人
- 希望通过 AI 持续扩大个人 Concept Vocabulary 的用户

第一阶段以单用户、本地使用为主。

---

## 5. 非目标

v1 不做：

- 百科全书
- 所有心理效应大全
- Skill Marketplace
- Prompt Marketplace
- 多用户协作平台
- 企业权限系统
- 云同步
- 社交社区
- 自动执行任意外部代码
- 复杂推荐算法平台
- 大规模向量数据库基础设施

---

## 6. 核心用户故事

### 场景 A：用户表达模糊

用户：

> 这个回答感觉什么都有，但重点不突出。

系统推荐：

**奥卡姆剃刀**

原因：

> 当前问题主要是非必要复杂度过多。奥卡姆剃刀可以帮助删除不增加解释力的信息。

动作：

- 查看概念
- 应用到当前回答
- 忽略

---

### 场景 B：分析只看到直接影响

用户：

> 这个方案看起来不错，但我担心后续会不会有问题。

系统推荐：

**第二层思维**

原因：

> 当前分析主要停留在一阶结果，可以继续推演行为适应、反馈回路与后续影响。

---

### 场景 C：分析停留在事件

用户：

> 最近发生了很多事件，但我感觉把它们列出来没什么意义。

系统推荐：

**事件—局势—结构**

原因：

> 当前分析集中在短期事件层，可以扩展到中期趋势和长期结构。

---

### 场景 D：继续投入已有项目

用户：

> 已经做半年了，现在停掉感觉太浪费。

系统推荐：

1. 沉没成本
2. 机会成本

原因：

> 当前判断受到历史投入影响，同时缺少对未来替代方案价值的比较。

---

### 场景 E：Review 太单边

用户：

> 帮我看看这个方案还有没有问题。

系统可推荐：

1. 可证伪性
2. 逆向思维
3. 确认偏见

只有当这些 Concept 真正能增加新的检查视角时才推荐。

---

## 7. 产品组成

Concept Discovery 包含两个核心产品面。

### Part A：Local Concept System

职责：

- Concept Registry
- Concept CRUD
- 搜索
- Tag / Domain / Type 管理
- Source 管理
- Recipe 管理
- Recommendation Logs
- Eval Cases
- Dashboard
- Core API
- CLI

启动方式：

```bash
concept-discovery start
```

打开：

```text
http://localhost:<port>
```

第一阶段：

- 本地单用户
- 无登录
- SQLite
- 本地文件 / 数据库
- 不依赖 Docker
- 不依赖 PostgreSQL

---

### Part B：Concept Discovery Skill

Skill 本身保持很薄。

职责：

1. 判断当前场景是否值得发现 Concept
2. 收集任务 / 上下文 / 当前回答
3. 调用 recommend API / CLI
4. 将推荐结果清晰展示给用户
5. 用户选择后获取 Concept 详情
6. 生成当前场景 Prompt
7. 真正应用后记录 usage / feedback

Skill 不负责：

- 维护完整 Concept 数据库
- 自己扫描几百个 Markdown
- 自己实现版本系统
- 自己保存推荐日志

---

## 8. 总体架构

```text
                 Concept Discovery

┌─────────────────────────────────────┐
│              Local Web              │
│                                     │
│ Dashboard                           │
│ Concepts                            │
│ Sources                             │
│ Recipes                             │
│ Eval Cases                          │
│ Recommendation Logs                 │
└────────────────┬────────────────────┘
                 │
               Core API
                 │
        ┌────────┴────────┐
        │                 │
 Concept Registry    Recommendation Engine
        │                 │
        │            Context Diagnose
        │            Intent Routing
        │            Candidate Recall
        │            LLM Ranking
        │                 │
        └────────┬────────┘
                 │
             CLI / MCP
                 │
        concept-discovery Skill
                 │
               Agent
                 │
                 ▼
        Recommend 0~3 Concepts
                 │
        ┌────────┴────────┐
        ▼                 ▼
      Learn             Apply
                          │
                    Prompt Composer
```

---

## 9. 核心数据模型

### 9.1 Concept

```yaml
id: occams-razor
name: 奥卡姆剃刀
aliases:
  - Occam's Razor

status: core

interaction_type: operator
epistemic_type: principle

summary: >
  在解释力相近时，优先选择假设更少、结构更简单的解释。

trigger:
  - 回答冗余
  - 方案过度设计
  - 存在大量非必要假设
  - 多个解释效果相近

avoid_when:
  - 复杂性本身是问题的重要组成部分
  - 简化会删除关键约束或证据

transform:
  - 删除无贡献复杂度
  - 提高信息密度

agent_instruction: >
  删除对核心结论没有贡献的假设、步骤和重复信息；
  保留关键事实、证据和必要因果链；
  效果相近时优先选择更简单的表达或方案。

tags:
  - compression
  - explanation

domains:
  - reasoning
  - communication

intents:
  - simplify
  - reduce_complexity

related:
  - knowledge-distillation
  - first-principles

source:
  title: ...
  url: ...
  notes: ...

version: 1
```

---

## 10. Concept 分类

### 10.1 interaction_type

表示 Agent 应该如何使用它。

```text
operator
lens
procedure
```

operator：
直接改变推理方式。

例：
- 第一性原理
- 第二层思维
- 奥卡姆剃刀
- 逆向思维

lens：
用于检查偏差、风险或遗漏。

例：
- 确认偏见
- 幸存者偏差
- 沉没成本
- 古德哈特定律

procedure：
有明确步骤的方法。

例：
- 决策树
- 六顶思考帽
- 循证实践

---

### 10.2 epistemic_type

表示 Concept 本身是什么性质。

```text
formal_model
empirical_finding
heuristic
principle
framework
law
bias
```

两个字段解决不同问题：

```text
interaction_type
→ Agent 怎么使用它

epistemic_type
→ 这个 Concept 本身是什么
```

---

## 11. Intent 层

推荐器不应该只做：

`Context → Concept`

应该增加中间层：

`Context → Intent → Concept`

例：

```text
用户：
还有没有其他解释？

Intent：
alternative_explanation

候选：
- 奥卡姆剃刀
- 汉隆剃刀
- 可证伪性
```

建议第一版 Intent：

- simplify
- challenge_assumption
- find_counterexample
- explore_consequences
- compare_options
- detect_bias
- broaden_perspective
- analyze_risk
- analyze_structure
- clarify_explanation
- validate_evidence
- escape_stuck_thinking

Intent 是推荐系统的重要中间抽象。

---

## 12. Recipe

Recipe 是一组互补 Concept。

例：

### Deep Review

```text
逆向思维
可证伪性
确认偏见
第二层思维
```

### Strategic Analysis

```text
事件—局势—结构
第二层思维
机会成本
```

### Information Compression

```text
奥卡姆剃刀
知识蒸馏
知识诅咒
```

Registry 保持 Concept 原子化，Recipe 只维护组合关系。

---

## 13. 搜索与推荐

### 13.1 Search

用于用户已经知道自己想找什么。

```text
search_concepts(query)
```

例：

```bash
concept-discovery search "奥卡姆"
```

---

### 13.2 Recommend

核心能力。

```text
recommend_concepts(context)
```

输入：

```json
{
  "task": "...",
  "context": "...",
  "response": "...",
  "user_intent": "...",
  "limit": 3
}
```

输出：

```json
{
  "diagnosis": [
    "当前分析主要停留在直接影响",
    "缺少后续反馈和行为适应"
  ],
  "recommendations": [
    {
      "id": "second-order-thinking",
      "name": "第二层思维",
      "reason": "可以继续推演一阶结果之后的连锁影响",
      "confidence": 0.91
    }
  ]
}
```

允许：

```json
{
  "recommendations": []
}
```

接口约定：机器接口中的「无推荐」统一表示为 `recommendations: []`；`NONE` 只作为展示层标签，不作为返回值。空推荐时 `diagnosis` 仍可携带，用于解释为什么没有合适 Concept。

---

## 14. 推荐流程

v1：

```text
Task / Context / Response
        ↓
Context Diagnosis
        ↓
Intent Classification
        ↓
Core Concept Catalog
        ↓
LLM Router / Ranker
        ↓
0~3 Recommendations
```

当 Concept 数量在 20~100 时：

- 不需要复杂向量数据库
- 可以给 Router 提供紧凑 Concept Cards
- LLM 直接完成诊断 + 排序

规模扩大后：

```text
Context
↓
Keyword / Tag / Embedding Recall
↓
10~20 Candidates
↓
LLM Rerank
↓
0~3 Concepts
```

---

## 15. 推荐规则

硬规则：

1. 可以返回空推荐（`recommendations: []`）
2. 默认推荐 1 个
3. 最多 3 个
4. 不因为关键词相同就推荐
5. 每个推荐必须说明 Why Now（即输出中的 `reason` 字段）
6. 只有能改变当前思考、判断或表达时才推荐
7. 多个 Concept 高度重叠时只保留增益最大的一个
8. 推荐必须考虑 avoid_when
9. 优先补当前上下文缺失的视角
10. 禁止“方法论炫技”

---

## 16. Discovery Card

用户看到的核心 UI 单元。

```text
奥卡姆剃刀

为什么现在推荐
当前回答包含多个对核心结论没有贡献的分支，
主要问题是非必要复杂度。

它是什么
在解释力相近时，优先采用假设更少、
结构更简单的解释。

它会改变什么
删除无贡献的信息，提高信息密度。

[应用到当前任务]
[查看详情]
[忽略]
```

这是 Concept Discovery 的核心产品产物。

---

## 17. Prompt Composer

用户点击“应用”后：

输入：

```text
Concept
+
Current Task
+
Current Response
+
User Intent
```

输出：

```text
Contextual Prompt
```

例如第二层思维：

通用 Instruction：

> 对一阶结果继续追问“然后呢”，至少分析到第二层后果。

在产品架构任务里：

> 对当前架构方案先列出直接收益，再推演采用后团队行为、维护成本、依赖扩张和未来迁移成本。

在商业任务里：

> 对该促销策略先分析短期销售影响，再分析用户预期、渠道行为和长期价格锚点变化。

同一个 Concept 不存一份固定 Prompt。

---

## 18. API / CLI

第一版建议至少提供：

```text
GET  /api/concepts
GET  /api/concepts/:id
POST /api/concepts/search
POST /api/concepts/recommend
POST /api/concepts/feedback
POST /api/prompts/compose
```

CLI：

```bash
concept-discovery list

concept-discovery search "复杂度"

concept-discovery recommend \
  --task "..." \
  --response "..."

concept-discovery get occams-razor

concept-discovery feedback \
  occams-razor \
  --event applied
```

MCP 可以在 v1.1 增加。

---

## 19. Feedback / Usage

必须区分：

```text
recommended
viewed
applied
ignored
not_useful
```

“推荐过”和“真正应用过”是两件事。

推荐日志示例：

```json
{
  "task_id": "...",
  "concept_id": "occams-razor",
  "event": "applied",
  "concept_version": 3,
  "timestamp": "..."
}
```

---

## 20. Dashboard

Dashboard 关注推荐质量，而不是普通知识库统计。

核心指标：

```text
Concepts                       58

本周推荐                       124
本周应用                        67
Apply Rate                   54%

推荐后查看率                   71%
NONE Rate                    32%
```

Concept 指标：

```text
奥卡姆剃刀
推荐 128
查看 74
应用 63

Apply Rate 49%
```

异常信号：

```text
高推荐 / 低应用
→ Trigger 可能过宽

低推荐 / 高应用
→ Trigger 可能过窄

经常共同出现
→ 候选 Recipe

经常被忽略
→ Definition / Recommendation Reason 需要优化
```

---

## 21. Eval

Eval 从 MVP 阶段进入核心功能。

因为真正需要验证的是：

> 该推荐的时候推荐对了吗？

测试集示例：

### Case 1

输入：

> 这个回答太啰嗦，很多内容删掉也不影响结论。

期望：

```text
奥卡姆剃刀
知识蒸馏
```

不希望：

```text
第一性原理
六顶思考帽
```

---

### Case 2

输入：

> 我们已经做这个项目六个月了，再停感觉很浪费。

期望：

```text
沉没成本
机会成本
```

---

### Case 3

输入：

> 2+2 等于多少？

期望：

```text
NONE（recommendations: []）
```

---

### Eval 指标

- Recommendation Precision
- NONE Precision
- Top-1 Hit Rate
- Over-recommendation Rate
- Human Acceptance Rate
- Apply Rate

推荐器的成功标准不是“总能推荐”。

成功标准是：

> 有增益时能发现，没有增益时能闭嘴。

---

## 22. Concept 版本

第一版数据模型中直接保留：

```text
version
```

目的：

- Trigger 会不断修改
- Description 会不断优化
- Instruction 会不断变化
- 推荐质量必须能与版本关联

v1 可以只记录 version number。

完整 immutable revision / restore 后续再做。

---

## 23. Concept Registry 初始规模

MVP 推荐池目标为 20~30 个通过准入的 Core Concepts。[清洗稿](method-registry-curated-v0.1.md) 已清洗出 30 个候选条目，但正式准入尚未完成；下列是优先覆盖范围，不是最终名单。

优先覆盖：

### 推理

- 第一性原理
- 第二层思维
- 奥卡姆剃刀
- 逆向思维
- 可证伪性
- 萨根标准

### 决策

- 沉没成本
- 机会成本
- 决策树
- 安全边际

### 偏差检查

- 确认偏见
- 幸存者偏差
- 锚定效应
- 易得性偏差
- 基本归因错误
- 取样偏差

### 表达 / 沟通

- 知识诅咒
- 知识蒸馏

### 多视角

- 六顶思考帽
- 事件—局势—结构

### 证据

- 循证实践
- 古德哈特定律

初始数量必须克制。

推荐质量优先于 Concept 数量。

---

## 24. Web 页面

v1 页面：

### Dashboard

- 推荐统计
- Apply Rate
- NONE Rate
- Top Concepts
- 低质量 Trigger 提示

### Concepts

- 列表
- 搜索
- Filter
- Tag
- Status
- Domain

### Concept Detail

- Name
- Summary
- Trigger
- Avoid When
- Transform
- Agent Instruction
- Related
- Source
- Version
- Example

### Recipes

- Recipe 列表
- Recipe 详情
- Concept 组合

### Recommendation Logs

- Task
- Recommended Concepts
- User Action
- Version
- 时间

### Eval Cases

- 输入
- Expected
- Forbidden
- 实际结果
- Pass / Fail

### Settings

- LLM Provider
- Model
- API Key
- Recommendation Threshold

---

## 25. MVP 技术建议

第一阶段：

```text
TypeScript
Bun / Node
Hono / Fastify
React / Next.js
SQLite
```

保持：

- 单仓库
- 单用户
- Local-first
- 一条启动命令
- 无 Docker 必需
- 无登录
- 无权限系统
- 无云服务依赖

推荐引擎可直接调用用户配置的模型 API。

---

## 26. 参考项目吸收策略

### cc-thinking-skills

吸收：

- Router
- NONE
- Trigger
- When NOT to Use
- 默认 1 个，最多 3 个
- Routing Eval

不吸收：

- 一个 Concept 一个独立 Skill

---

### model-thinking

吸收：

- 用户无需知道模型名
- 单 Skill + 大量 References
- 按需读取
- 跨领域分类
- formal / empirical / heuristic 等性质区分

不吸收：

- 把多个 Concept 合并成一个底层资产
- 推荐后直接隐藏 Concept 执行

---

### skills-manager

吸收：

- Local Library
- Search / Tag / Preview
- UI 管理体验
- CLI + Shared Core
- Activity 思路

不吸收：

- Tauri Desktop
- 多 Agent 部署管理
- Symlink / deployment 等系统复杂度

---

### myskills

吸收：

- Registry-first
- API / Web / CLI / MCP 分层
- Agent 通过稳定接口访问 Registry

不吸收：

- Auth / MFA
- 多角色
- 发布审核
- Marketplace
- 企业权限

---

### skillbox

重点吸收：

- Search 与 Recommend 分离
- Task-aware Recommendation
- Load / Usage Reporting
- Library + MCP + CLI + Recommendation 闭环
- Version 概念
- Thin Bootstrap Skill

不吸收：

- PostgreSQL 必需
- Docker 必需
- Client Key
- Profile / Grant
- Proposal
- Executor
- HTTPS / Remote Hosting
- 完整版本发布基础设施

---

## 27. 开发阶段

### Phase 0：Concept Cleaning

目标：

把现有知识文档整理成 20~30 个 Core Concepts。

任务：

- 去重
- 分类
- Trigger
- Avoid When
- Transform
- Instruction
- Source
- Intent
- Version

---

### Phase 1：Registry + Local Web

实现：

- SQLite
- Concept Schema
- CRUD
- Search
- Tag / Domain
- Concept Detail
- Import Markdown / JSON
- Local Server

验收：

```bash
concept-discovery start
```

即可打开 Web 管理 Concept。

---

### Phase 2：Recommend Engine

实现：

- Diagnosis
- Intent Router
- Concept Router
- NONE
- 0~3 推荐
- Reason
- Confidence

同时建立第一批 Eval Cases。

这是产品最关键阶段。

---

### Phase 3：Skill

实现一个：

```text
concept-discovery/SKILL.md
```

Agent：

```text
Current Context
↓
recommend
↓
Discovery Card
↓
User Choice
```

---

### Phase 4：Prompt Composer

实现：

```text
Concept × Context → Contextual Prompt
```

用户可以点击：

```text
Apply
```

重新执行 Agent。

---

### Phase 5：Feedback Loop

加入：

- recommended
- viewed
- applied
- ignored
- not_useful

Dashboard 开始分析 Trigger 质量。

---

### Phase 6：Scale

只有 Concept 数量明显扩大后才增加：

- Embedding Recall
- Hybrid Search
- LLM Rerank
- MCP
- 用户偏好
- Recipe Recommendation
- 完整 Revision History

---

## 28. v1 验收标准

### System

必须支持：

- 一条命令启动
- 浏览器访问
- Concept CRUD
- 搜索
- Tag / Domain
- 20~30 Core Concepts
- Concept Detail
- Recommendation Logs
- Eval Cases

### Recommendation

给定：

```text
task
context
response(optional)
```

必须：

- 判断是否值得推荐
- 可以返回空推荐（NONE，`recommendations: []`）
- 默认 Top-1
- 最多 Top-3
- 给出 Why Now
- 给出 Confidence
- 不重复推荐高度相似 Concept

### Skill

必须：

- 能被 Agent 调用
- 使用 System Registry
- 显式展示 Concept
- 支持查看
- 支持 Apply
- 支持 Ignore

### Prompt

必须：

- 根据当前上下文动态生成
- 不直接使用固定模板替换全部场景

### Eval

必须：

- 至少 50 个真实场景
- 包含应该推荐
- 包含不应该推荐
- 包含多个 Concept 竞争场景

---

## 29. 成功指标

北极星信号：

> 用户看到推荐后产生：
> “对，这个概念我刚才确实没想到，而且它有帮助。”

量化指标：

- Recommendation Acceptance Rate
- Apply Rate
- NONE Accuracy
- Top-1 Human Preference
- Ignore Rate
- Not Useful Rate
- Repeat Use Rate

早期最重要的是人工 Eval。

不要过早追求推荐算法复杂度。

---

## 30. 最终产品边界

Concept Discovery 的四层：

```text
Concept Registry
      ↓
Recommendation Engine
      ↓
Discovery Skill
      ↓
Prompt Composer
```

系统分别回答四个问题：

```text
Registry
→ 人类已经有哪些 Concept？

Recommendation
→ 当前上下文最值得提醒哪个 Concept？

Discovery
→ 为什么现在应该想到它？

Prompt Composer
→ 这个 Concept 在当前任务里怎么具体使用？
```

产品长期价值来自：

> 把人类已经存在、但用户此刻没有想到的理论、模型、原则和认知工具，在正确的上下文中重新送到用户面前。

这就是 Concept Discovery。

---

## 31. 风险与未决问题

### 31.1 风险

**风险 1：推荐变成“方法论炫技”**

- 只在高置信度时展示
- 支持空推荐
- 默认最多 3 个
- 强制解释“为什么此刻需要”

**风险 2：Concept 语义过于模糊**

- Registry 保留 `trigger` / `transform` / `agent_instruction` / `avoid_when`

**风险 3：词条过多**

- 建立准入机制，见 [清洗稿 §2](method-registry-curated-v0.1.md#2-准入标准)

**风险 4：推荐与执行耦合过深**

- 分离 Recommend 与 Apply，用户保留最终决定权

**风险 5：LLM 置信度不可靠**

- `confidence` 需定义来源与校准方式，并在 Eval 中验证

**风险 6：反馈指标被“多推荐”激励**

- 用 NONE Rate、NONE Precision、Over-recommendation Rate 制衡 Apply Rate

### 31.2 未决问题

- 产品与文件命名：产品已改名 Concept Discovery，文件路径仍为 `method-*`
- 字段名冲突：`type` 与 `interaction_type`、`related` 与 `related_methods`
- Core 准入门槛：PRD 未复述，以 [清洗稿 §2](method-registry-curated-v0.1.md#2-准入标准) 为准还是另行定稿
- Eval 的数值通过门槛、场景来源与判定方式（见 §21、§28）

详见 [产品契约](../specs/product-contract.md)。

---

## 32. 隐私与安全边界

- 推荐引擎调用用户配置的模型 API 时，任务、上下文与回答会离开本机；Settings 必须向用户说明这一点。
- Settings 中的 API Key 不得写入仓库、推荐日志或普通文本文件；本地存储方式需在实现前决定。
- 本地服务默认绑定 `127.0.0.1`；“无登录”只适用于本机访问。
- Recommendation Logs 若保存任务内容，需定义保留期与本机存储位置。
