# PRD：Method System + Agent Method Skills

版本：v0.1  
状态：Draft  
日期：2026-09-23

---

## 1. 产品概述

本产品用于帮助人在与 Agent / LLM 对话时，发现自己当前可能需要但没有主动想到的方法论，并将这些方法论进一步转化为 Agent 可执行的提示词。

产品由两部分组成：

1. **Method System**
   - 本地启动服务
   - 浏览器访问
   - 用于管理、筛选、编辑、组织方法论词条
   - 提供 Dashboard 纵览
   - 作为整个产品的方法论资产中心

2. **Agent Method Skills**
   - 供 Agent 调用的方法论推荐 Skill / Skill 组
   - 读取当前任务、上下文、Agent 当前回答
   - 诊断当前思路可能存在的问题
   - 推荐 1~3 个适用的方法论
   - 根据当前上下文生成完整、可直接执行的 Prompt
   - 可进一步由 Agent 直接应用

核心产品目标：

> 当用户自己不知道“此刻应该用什么方法思考”时，系统能够基于上下文主动推荐合适的方法论，并帮助 Agent 将方法论落地到当前任务。

产品本质可以理解为：

> 一个由 LLM 驱动的“上下文方法论推荐系统”。

---

## 2. 背景与问题

### 2.1 当前痛点

用户在与 LLM / Agent 对话时，经常知道自己“对结果不满意”，但不知道应该通过什么方法论改善。

典型情况：

- Agent 回答太啰嗦，但用户只会说“简短一点”
- Agent 思路过窄，但用户只会说“再想深一点”
- Agent 分析停留在表面事件，用户难以主动想到长期结构视角
- Agent 只寻找支持已有结论的证据，用户没有意识到确认偏见
- 用户因为项目已投入大量时间而犹豫是否继续，但没有主动意识到沉没成本

传统 Prompt Library 解决的是：

> 用户已经知道自己需要什么，然后去找 Prompt。

本产品解决的是：

> 用户自己不知道需要什么，由 Agent 根据上下文主动发现并推荐。

---

## 3. 产品定位

### 3.1 产品定义

**Method System + Agent Method Skills**

一句话：

> 根据用户当前的问题、思考过程和 Agent 回答，主动推荐此刻最值得使用的方法论，并生成上下文化的完整 Prompt。

### 3.2 类比

类似 Spotify / Netflix 的推荐系统：

- 用户不需要知道内容库里有什么
- 系统根据当前上下文推荐最适合的内容
- 推荐对象从“歌曲 / 电影”变成“方法论”

推荐模型可以抽象为：

```text
User × Problem × Context × Method
```

---

## 4. 产品原则

### 4.1 人是主体

方法论推荐首先服务用户的认知。

产品需要回答：

- 用户当前在思考什么？
- 当前思路可能缺少什么？
- 什么方法论能帮助用户看到之前没看到的东西？

### 4.2 只收录高价值方法论

Method System 是精选方法论 Registry。

词条只有满足以下条件才进入正式 Registry：

1. 能显著改变 Agent 的推理方式
2. 能替代较长的自然语言提示
3. 有清晰的适用场景
4. 能转化成明确的 Agent Instruction
5. 与已有方法存在明显功能差异
6. 能回答“什么时候应该想起这个方法”

### 4.3 推荐优先于搜索

用户的主要体验：

```text
当前上下文
→ 系统诊断
→ 主动推荐
→ 用户理解
→ 一键应用
```

### 4.4 Prompt 是动态生成物

Registry 中主要存：

```text
Method
Trigger
Diagnosis
Transform
Instruction
Constraints
```

Skill 根据：

```text
Method × 当前任务 × 当前回答 × 用户意图
```

动态生成 Contextual Prompt。

---

## 5. 目标用户

### 5.1 核心用户

高频使用 ChatGPT、Claude、Codex、Claude Code、Cursor、OpenCode 等 Agent / LLM 的用户。

典型特征：

- 经常做复杂分析、Review、决策、研究或创作
- 已经知道 Prompt 会影响 Agent 质量
- 希望减少“我该怎么提示 Agent”的认知负担
- 对第一性原理、奥卡姆剃刀、逆向思维、第二层思维等方法论有兴趣
- 无法记住大量方法，也无法在每次对话中主动联想到合适的方法

---

## 6. 核心场景

### 场景 A：Agent 回答过于冗余

用户感知：

> 回答废话很多，但我不知道怎么有效要求它改善。

Skill 诊断：

```text
信息重复
支线过多
对结论贡献有限的背景信息过多
```

推荐：**奥卡姆剃刀**

进一步生成 Prompt：

```text
重新审视上一轮回答。

依据奥卡姆剃刀：
1. 删除不影响核心结论的背景说明、重复观点和支线信息；
2. 保留支撑判断所必需的事实、证据和因果关系；
3. 多个解释具有相同解释力时，采用更简单的解释；
4. 优先提高信息密度。
```

### 场景 B：Agent 思路太窄

用户感知：

> 回答看起来没错，但思路太窄。

Skill 诊断：

```text
仅讨论直接影响
缺少后续连锁变化
缺少中长期视角
```

推荐：

- 第二层思维
- 理解世界的三个层次：事件、局势、结构

### 场景 C：用户在已有投入下做继续 / 停止决策

用户输入：

> 这个项目已经做半年了，效果一般，要不要继续？

Skill 诊断：

```text
历史投入正在参与当前决策
可能存在沉没成本影响
缺少替代方案比较
```

推荐：

- 沉没成本
- 机会成本
- 可证伪性

### 场景 D：Agent Review 过于单一

用户输入：

> Review 一下这个技术方案。

推荐：

- 逆向思维
- 可证伪性
- 第二层思维
- 奥卡姆剃刀

可组成 Recipe：

```text
Deep Review =
逆向思维
+ 可证伪性
+ 第二层思维
+ 奥卡姆剃刀
```

---

## 7. 产品组成

# Part A：Method System

### 7.1 产品形态

本地启动服务：

```bash
method-system start
```

浏览器访问本地 Web UI。

### 7.2 主要功能

#### Dashboard

展示：

- 总方法数
- Core Methods 数量
- Review Lenses 数量
- Experimental 数量
- 最近常被推荐的方法
- 推荐后采用率
- 经常组合出现的方法
- 被频繁忽略的方法
- 最近新增 / 修改方法

#### Method 管理

支持：

- 新建
- 编辑
- 删除
- 搜索
- Tag
- 分类
- 状态管理
- 去重
- 关联方法
- 导入 Markdown
- 导出 JSON / Markdown

### 7.3 Method 类型

#### Operator

直接改变 Agent 如何思考。

例如：第一性原理、奥卡姆剃刀、逆向思维、第二层思维。

#### Lens

用于检查当前思考是否存在偏差。

例如：确认偏见、幸存者偏差、沉没成本、古德哈特定律。

#### Procedure

规定一个多步骤分析流程。

例如：决策树、六顶思考帽、循证实践、事件—局势—结构。

#### Concept

有解释力，但 Agent 使用价值较弱。默认不进入核心推荐池，可作为候选或实验词条。

---

## 8. Method 数据模型

推荐 Schema：

```yaml
id: occams-razor
name: 奥卡姆剃刀
aliases:
  - Occam's Razor

type: operator
status: core

summary:
  在保持解释力的前提下，优先选择更简单、假设更少的解释或表达。

trigger:
  - 信息重复
  - 回答过长
  - 解释层次过多
  - 存在大量非必要假设
  - 多个方案效果相近但复杂度不同

diagnosis:
  - excessive_complexity
  - low_information_density
  - unnecessary_assumptions

transform:
  - 删除不必要复杂度
  - 提升信息密度
  - 保留关键事实和因果链

instruction: |
  删除对核心结论没有贡献的信息；
  保留关键事实、证据和必要因果关系；
  多个解释具有相同解释力时优先选择更简单者。

avoid_when:
  - 复杂性本身包含关键因果信息
  - 任务要求完整保留细节

related:
  - first-principles
  - knowledge-distillation

use_cases:
  - summarize
  - simplify
  - architecture-review
  - writing
```

---

## 9. Agent Method Skills

第一阶段建议拆成 3 个逻辑 Skill，也可以对外提供一个统一 Skill。

### Skill 1：Diagnose

作用：

> 分析用户问题、对话上下文和 Agent 当前输出，判断当前思考可能存在哪些缺口。

输入：

```json
{
  "task": "...",
  "context": "...",
  "response": "...",
  "user_intent": "..."
}
```

输出：

```json
{
  "diagnosis": [
    {
      "code": "narrow_time_horizon",
      "description": "当前分析主要集中于直接影响，缺少中长期视角"
    }
  ]
}
```

### Skill 2：Recommend

作用：

> 从 Method Registry 中选择此刻最值得提醒用户的 1~3 个方法。

核心问题：

> 用户当前可能遗漏了什么值得提醒的思维工具？

输出：

```json
{
  "recommendations": [
    {
      "method_id": "second-order-thinking",
      "name": "第二层思维",
      "reason": "当前回答主要讨论直接结果，缺少后续连锁影响",
      "confidence": 0.91
    }
  ]
}
```

### Skill 3：Compose

作用：

> 将被选中的 Method 根据当前上下文编译成完整 Prompt。

输入：

```text
Method
+
Task
+
Context
+
Current Response
+
User Intent
```

输出：

```text
Contextual Prompt
```

---

## 10. Skill 最终产物

### Level 1：推荐词条

```text
推荐：奥卡姆剃刀
```

### Level 2：推荐词条 + 原因

```text
推荐：奥卡姆剃刀

原因：
当前回答存在多个对结论贡献有限的解释和重复论述。

作用：
提高信息密度，保留关键事实和因果关系。
```

这是默认 UI 展示形式。

### Level 3：完整 Prompt

```text
依据奥卡姆剃刀重新回答：
- 删除重复信息和无关支线
- 保留关键事实和必要因果链
- 多种表达效果一致时采用最简形式
```

这是 Agent 实际执行使用的最终产物。

---

## 11. Skill 的推荐流程

```text
用户问题 / 当前对话
          ↓
读取 Task + Context + Response
          ↓
Diagnose
识别当前认知问题
          ↓
从 Registry 中召回候选 Method
          ↓
LLM 判断相关性 / 补充价值
          ↓
Recommend 1~3 个
          ↓
用户选择
   │
   ├── 查看方法
   ├── 应用单个
   ├── 应用全部
   └── 忽略
          ↓
Compose
生成上下文化 Prompt
          ↓
Agent 执行
```

---

## 12. 推荐系统实现策略

### MVP

第一阶段无需构建传统机器学习推荐系统。

直接使用：

```text
Method Registry
+
LLM Router Agent
```

Method 数量控制在 20~50 个时，可以将精简后的 Method Cards 提供给 LLM，由 LLM 根据当前上下文进行判断和排序。

### 第二阶段

词条增加后升级为两阶段推荐：

```text
用户上下文
    ↓
粗召回
Keyword / Tag / Embedding
    ↓
10~20 个候选 Method
    ↓
LLM Router
理解上下文 + Rerank
    ↓
1~3 个推荐
```

### 第三阶段

引入用户反馈：

```text
推荐
↓
采用 / 忽略 / 不感兴趣
↓
反馈数据
↓
调整 Trigger / Rank / 用户偏好
```

---

## 13. 推荐质量原则

### 13.1 少而准

默认推荐 1~3 个。

### 13.2 允许无推荐

系统必须允许返回：

```json
{
  "recommendations": []
}
```

没有明显增益时保持安静。

### 13.3 推荐需要解释

每个推荐至少回答：

1. 为什么现在推荐？
2. 它会怎样改变当前思考？

### 13.4 推荐以“补充认知”为目标

优先寻找：

- 当前缺失视角
- 当前思维偏差
- 被忽略的时间尺度
- 未验证假设
- 未考虑的失败路径

---

## 14. UI 设计

### 14.1 Web Dashboard

主要页面：

```text
Dashboard
Methods
Recipes
Recommendation Logs
Settings
```

### 14.2 Method Detail

字段：

```text
Name
Aliases
Type
Status
Summary
Trigger
Diagnosis
Transform
Instruction
Avoid When
Use Cases
Related Methods
Examples
Tags
```

### 14.3 推荐 UI

Agent 侧推荐卡：

```text
💡 你可能需要

第二层思维

为什么推荐：
当前回答主要分析直接结果，缺少后续连锁影响。

能带来什么：
继续推演结果之后的结果。

[应用] [查看] [忽略]
```

---

## 15. Recipe

多个 Method 可以组成 Recipe。

例如：

### Deep Review

```text
逆向思维
+
可证伪性
+
第二层思维
+
奥卡姆剃刀
```

### Strategic Analysis

```text
第一性原理
+
事件—局势—结构
+
第二层思维
+
机会成本
```

### Information Compression

```text
奥卡姆剃刀
+
知识蒸馏
+
帕累托原则
```

---

## 16. Dashboard 数据闭环

记录：

```text
Method 被推荐次数
Method 被采用次数
Method 被忽略次数
Method 推荐后继续使用次数
Method 与其他 Method 共现次数
不同任务类型下的采用率
```

这些数据用于调整 Trigger、Rank 和词条质量。

---

## 17. MVP 范围

### 17.1 Method System

必须有：

- 本地服务启动
- Browser Web UI
- Method CRUD
- Method Search
- Tag / Type / Status
- Markdown 导入
- Registry JSON
- 简单 Dashboard

暂缓：

- 多用户
- 云同步
- 社区
- Marketplace
- 复杂权限系统

### 17.2 Skills

必须有：

- Diagnose
- Recommend
- Compose
- 支持当前 Task
- 支持 Context
- 支持 Agent 当前 Response
- 返回 1~3 个 Method
- 返回推荐原因
- 生成 Contextual Prompt

### 17.3 初始 Method 数量

建议：

```text
20~30 个 Core Methods
```

从现有材料中筛选，最终名单经过单独准入审查。

---

## 18. 非目标

第一阶段不做：

- 方法论百科全书
- 大而全的知识管理系统
- 自动收录所有心理学效应
- 传统协同 Wiki
- 大规模推荐算法平台
- 复杂向量数据库架构
- 纯 Prompt Marketplace

---

## 19. 核心成功指标

### 核心指标

用户看到推荐后产生：

> “对，这个方法我刚才确实没想到，而且它对当前问题有帮助。”

### 可量化指标

- Recommendation Acceptance Rate
- Method Application Rate
- Ignore Rate
- Repeat Recommendation Acceptance
- 每次推荐数量
- 无推荐比例

### MVP 验证目标

```text
LLM 是否能稳定发现当前思考缺口？
↓
是否能推荐出合理 Method？
↓
用户是否认为推荐有启发？
↓
生成 Prompt 后是否能明显改善 Agent 输出？
```

---

## 20. 风险

### 风险 1：推荐变成“方法论炫技”

解决：

- 高置信度才展示
- 支持 none
- 默认最多 3 个
- 强制解释“为什么此刻需要”

### 风险 2：方法论语义过于模糊

解决：

Registry 中保留：

```text
Trigger
Transform
Instruction
Avoid When
```

### 风险 3：词条过多

解决：

建立准入机制：

```text
是否能改变 Agent 行为？
是否能压缩 Prompt？
是否有明确 Trigger？
是否有明确 Transform？
是否有真实使用场景？
```

### 风险 4：推荐和执行耦合过深

解决：

区分：

```text
Recommend
```

和：

```text
Apply
```

用户保持最终决定权。

---

## 21. 技术架构建议

```text
                  Local Method System
                         │
                  Method Registry
                         │
          ┌──────────────┼──────────────┐
          │              │              │
       Web UI         Skill API       CLI
          │              │
     管理 Method      Agent 调用
                         │
                         ▼
                 LLM Method Router
                         │
                  Diagnose / Rank
                         │
                         ▼
                  Prompt Composer
                         │
                         ▼
                       Agent
```

Registry 是单一事实来源。

推荐底层可以先使用 JSON / Markdown。

---

## 22. 数据存储建议

```text
methods/
  operators/
  lenses/
  procedures/
  experimental/

recipes/

data/
  recommendation-logs/
```

每个 Method 使用 Markdown + YAML 或 JSON。

Web 系统操作后直接更新 Registry。

Skill 读取同一份 Registry。

---

## 23. 第一阶段开发顺序

### Phase 0：方法论清洗

从现有材料中：

```text
筛选
去重
分类
补 Trigger
补 Diagnosis
补 Transform
补 Instruction
```

产出首批 20~30 个 Method。

### Phase 1：Registry + Web

完成：

```text
Method Schema
CRUD
Search
Dashboard
Markdown Import
```

### Phase 2：Recommend Skill

完成：

```text
Task → Recommend
Context → Recommend
Response → Diagnose → Recommend
```

### Phase 3：Compose Skill

完成：

```text
Method × Context → Prompt
```

### Phase 4：Feedback

加入：

```text
Apply
Ignore
Not useful
```

并进入 Dashboard。

### Phase 5：智能召回

方法数量明显增加后再加入：

```text
Embedding
Rerank
User Preference
Recipes Recommendation
```

---

## 24. 第一版验收标准

### Method System

- 可以在本地一条命令启动
- 浏览器可访问
- 可以查看所有 Method
- 可以 CRUD
- 可以搜索
- 可以查看 Dashboard
- 可以导入现有 Markdown
- Method 数据可以被 Skill 读取

### Skill

给定：

```text
用户问题
+
可选的当前 Agent 回答
```

Skill 可以：

1. 诊断当前思路的主要缺口
2. 推荐最多 3 个 Method
3. 解释推荐原因
4. 返回置信度
5. 允许返回无推荐
6. 根据 Method 生成上下文化 Prompt

### 用户体验

用户可以完成：

```text
看到推荐
→ 理解为什么推荐
→ 点击应用
→ Agent 根据生成 Prompt 重新执行
```

---

## 25. 产品最终形态

完整产品成果：

```text
一个本地方法论资产管理系统
+
一组 Agent Method Skills
```

Method System 回答：

> 我拥有哪些方法论？

Recommend Skill 回答：

> 此刻哪些方法论值得提醒我？

Compose Skill 回答：

> 这个方法在当前任务里应该具体怎么提示 Agent？

最终形成：

```text
Method Registry
      ↓
Context Diagnosis
      ↓
Method Recommendation
      ↓
Contextual Prompt
      ↓
Agent Execution
      ↓
User Feedback
      ↓
Registry / Recommendation Improvement
```

产品的长期价值：

> 在正确的上下文里，把正确的方法论递给用户，并把它转换成 Agent 真正能执行的思考指令。
