# Method Registry 清洗稿 v0.1

来源：`daily-knowledge(1).md`
用途：Method System + Agent Method Skills

> 说明：原文是一份知识笔记，主要字段是“核心 / 内容 / 举例 / 反思 / 局限”。本稿按产品需求重构为 `Trigger → Transform → Instruction`。这些字段属于基于原文含义与当前产品需求的结构化转译，并非原文直接字段。对于原文只列出名称、缺少正文定义的词条，已显式标记 `source_note`，后续应补正式来源。

## 1. 清洗结论

- MVP Core：30 个方法论。
- 重复合并：`确认偏见` 与 `确认性偏差` 合并；软件工程法则和心智模型列表中的重复名词不重复建条目。
- 候选 Pack：保留有价值但适用范围更窄、与核心词条重叠或需要更多验证的词条。
- Archive：保留原知识，但默认不进入推荐池。

## 2. 准入标准

一个词条进入 Core，至少满足大部分条件：

1. 能改变 Agent 的推理、检查或输出方式。
2. 能替代一段较长自然语言指令。
3. 能定义明确的触发场景。
4. 能转译成可执行 Agent Instruction。
5. 具备跨任务复用价值。
6. 与已有 Core Method 有明显功能差异。

## 3. Core Methods

### 1. 证伪主义 / 可证伪性

- id: `falsifiability`
- type: `operator`
- summary: 把主张改写成可被事实推翻的假设，并主动寻找反例。
- trigger:
  - 存在关键假设但缺少失败条件
  - 结论听起来正确却无法验证
  - Review 只在寻找支持证据
- transform:
  - 把抽象观点转成可检验命题
  - 优先寻找反例和失败证据
- agent_instruction: |
  明确当前结论成立所依赖的关键假设；为每个假设定义可观察的证伪条件；主动寻找能够推翻结论的证据。

### 2. 合成谬误

- id: `composition-fallacy`
- type: `lens`
- summary: 局部成立的性质，不能直接推出整体也成立。
- trigger:
  - 从少数局部样本推断整体
  - 把单个组件优秀直接等同于系统优秀
- transform:
  - 区分局部性质与整体涌现结果
- agent_instruction: |
  检查是否把局部成立的结论直接推广到整体；补充整体层面的交互、约束和反例。

### 3. 分解谬误

- id: `division-fallacy`
- type: `lens`
- summary: 整体成立的性质，不能直接推出每个部分都成立。
- trigger:
  - 从组织/群体/系统整体特征推断个体
  - 把平均值当作每个成员的属性
- transform:
  - 拆分整体统计与个体差异
- agent_instruction: |
  检查是否把整体属性直接赋给每个组成部分；明确个体差异、分布和例外。

### 4. 知识诅咒

- id: `curse-of-knowledge`
- type: `lens`
- summary: 掌握知识后容易高估别人已有的背景知识。
- trigger:
  - 解释对新人不友好
  - 大量术语未定义
  - Agent 默认用户知道背景
- transform:
  - 切换到接收者视角
  - 补齐必要前置知识
- agent_instruction: |
  假设读者缺少领域背景；识别当前表达中未经解释的概念、跳步和隐含前提，只补充理解所必需的背景。

### 5. 基本归因错误

- id: `fundamental-attribution-error`
- type: `lens`
- summary: 解释行为时容易高估个人因素、低估情境因素。
- trigger:
  - 把结果主要归因于能力、性格或动机
  - 对他人行为做强烈人格判断
- transform:
  - 补充环境、制度、资源和约束变量
- agent_instruction: |
  把当前归因拆成个人因素与情境因素；检查是否过度强调个人特质，并补充可能的环境约束。

### 6. 幸存者偏差

- id: `survivorship-bias`
- type: `lens`
- summary: 只观察留下来的成功样本，会忽略失败或不可见样本。
- trigger:
  - 从成功案例总结规律
  - 只分析现存产品/公司/方案
  - 缺少失败样本
- transform:
  - 主动寻找未被观察到的失败样本
- agent_instruction: |
  列出当前数据中不可见、退出或失败的样本；检查结论在加入这些样本后是否仍成立。

### 7. 奥卡姆剃刀

- id: `occams-razor`
- type: `operator`
- summary: 在解释力相近时，优先选择假设更少、结构更简单的解释。
- trigger:
  - 回答冗余
  - 方案过度设计
  - 存在大量非必要假设
  - 多个方案解释力相近
- transform:
  - 删除无贡献复杂度
  - 提高信息密度
- agent_instruction: |
  删除对核心结论没有贡献的假设、步骤和重复信息；保留关键事实、证据和必要因果链；效果相近时优先选择更简单的表达或方案。

### 8. 萨根标准

- id: `sagan-standard`
- type: `lens`
- summary: 越非同寻常的主张，需要越强的证据支持。
- trigger:
  - 结论非常反常或影响重大
  - 证据强度与主张强度不匹配
- transform:
  - 按主张强度提高证据门槛
- agent_instruction: |
  评估主张的异常程度与影响范围；检查现有证据是否足以支撑该强度的结论，并明确缺失的验证证据。

### 9. 确认偏见

- id: `confirmation-bias`
- type: `lens`
- summary: 人容易寻找支持已有立场的证据，并忽视反面信息。
- aliases: 确认性偏差
- trigger:
  - 已有明确结论再找证据
  - Review 只列优点或只列缺点
  - 论证明显单边
- transform:
  - 强制搜索反证和替代解释
- agent_instruction: |
  先写出当前默认立场；主动寻找最强反证、反例和替代解释；说明什么证据会让当前结论改变。

### 10. 知识蒸馏

- id: `knowledge-distillation`
- type: `operator`
- summary: 从复杂材料中提取核心概念、关键关系和高价值信息。
- trigger:
  - 材料很长
  - 信息密度低
  - 需要压缩但不能丢结构
- transform:
  - 保留核心概念与关系
  - 删除低价值细节
- agent_instruction: |
  提取决定理解和行动的核心概念、关键事实、因果关系与约束；删除重复、装饰性和低价值细节；保留必要上下文。

### 11. 循证实践

- id: `evidence-based-practice`
- type: `procedure`
- summary: 围绕明确问题，收集、评估、整合证据，再形成决策并复盘效果。
- trigger:
  - 需要做研究型判断
  - 证据来源复杂
  - 结论需要可追溯依据
- transform:
  - 从观点驱动切换到证据驱动
- agent_instruction: |
  明确问题；收集相关证据；评估证据质量与适用性；整合一致与冲突结果；形成决策；说明实施后的验证指标。

### 12. 锚定效应

- id: `anchoring-effect`
- type: `lens`
- summary: 最先出现的数字、观点或框架会过度影响后续判断。
- trigger:
  - 评估围绕首个数字展开
  - 用户先给了强观点
  - 估算高度依赖初始值
- transform:
  - 重置参考点
  - 引入独立基准
- agent_instruction: |
  识别当前判断中的初始锚点；暂时移除它，使用独立基准、历史分布或替代估计重新计算，再比较差异。

### 13. 机会成本

- id: `opportunity-cost`
- type: `operator`
- summary: 选择一个方案意味着放弃其他可行方案中价值最高的那个。
- trigger:
  - 资源有限
  - 多方案选择
  - 继续投入某项目
- transform:
  - 从单方案评估切换为替代方案比较
- agent_instruction: |
  列出当前资源可以投入的主要替代选项；比较从现在开始各方案的未来收益、成本和放弃的最佳机会。

### 14. 沉没成本

- id: `sunk-cost`
- type: `lens`
- summary: 已经发生且无法收回的投入，不应自动成为继续投入的理由。
- trigger:
  - 因为已经投入很多所以继续
  - 是否停止项目
  - 舍不得放弃已有方案
- transform:
  - 把历史投入从未来决策中剥离
- agent_instruction: |
  把不可回收的历史投入单独列出；重新从当前时点比较继续、停止和转向的未来成本与收益。

### 15. 决策树

- id: `decision-tree`
- type: `procedure`
- summary: 把决策拆成方案、条件、概率与结果，显式展示决策路径。
- trigger:
  - 多方案且条件复杂
  - 存在不同概率结果
  - 决策过程混乱
- transform:
  - 把隐性权衡结构化
- agent_instruction: |
  列出主要决策分支、关键条件、可能结果和必要概率；沿每条路径说明代价与收益，再比较叶节点。

### 16. 易得性偏差

- id: `availability-bias`
- type: `lens`
- summary: 容易想起或最近看到的案例，会被高估其频率和重要性。
- trigger:
  - 最近新闻主导判断
  - 用鲜明个案代替总体数据
  - 风险估计靠印象
- transform:
  - 从可回忆案例切换到基准率和完整样本
- agent_instruction: |
  识别当前判断是否由最近、醒目或容易回忆的案例驱动；补充基准率、历史分布和反例。

### 17. 六顶思考帽

- id: `six-thinking-hats`
- type: `procedure`
- summary: 按事实、情绪、风险、收益、创意和流程六种视角并行审视问题。
- trigger:
  - 讨论陷入单一视角
  - 团队意见混杂
  - 需要系统扩展思路
- transform:
  - 强制切换多个思维模式
- agent_instruction: |
  分别从事实、直觉情绪、风险、收益机会、创造性方案、流程控制六个视角分析；最后合并冲突和共识。

### 18. 社会期许偏差

- id: `social-desirability-bias`
- type: `lens`
- summary: 人在回答敏感问题时，可能倾向给出更符合社会期待的答案。
- trigger:
  - 调查/访谈/用户研究
  - 问题涉及形象与规范
  - 自报数据过于理想化
- transform:
  - 降低自报信息的表面可信度
  - 寻找行为证据
- agent_instruction: |
  检查数据是否来自自我陈述且受社会期待影响；优先寻找匿名数据、真实行为、间接指标或交叉验证。

### 19. 取样偏差

- id: `sampling-bias`
- type: `lens`
- summary: 样本来源和抽样方式会让样本无法代表总体。
- trigger:
  - 从有限用户样本推广到全部人群
  - 样本来源单一
  - 调查结果用于总体结论
- transform:
  - 检查代表性和漏掉的人群
- agent_instruction: |
  说明样本如何产生、哪些人更容易被纳入、哪些人被遗漏；评估结论能够推广到什么范围。

### 20. 错误共识效应

- id: `false-consensus-effect`
- type: `lens`
- summary: 人容易高估别人和自己观点一致的程度。
- trigger:
  - “大家都觉得”式判断
  - 用身边人代表市场
  - 把自己的偏好当普遍需求
- transform:
  - 显式寻找不同群体和反对意见
- agent_instruction: |
  把“大家”“用户”“市场”拆成具体群体；寻找与当前观点不同的人群、比例和证据，避免用自身圈层代表总体。

### 21. 分析瘫痪

- id: `analysis-paralysis`
- type: `lens`
- summary: 信息和选项过多时，持续分析会阻碍决策和行动。
- trigger:
  - 长期比较却无法行动
  - 候选项越来越多
  - 追求完美信息
- transform:
  - 收敛关键决策变量
  - 设定停止分析条件
- agent_instruction: |
  明确目标和必须满足的少数关键条件；限制候选数量；定义信息收集截止点和决策时限；允许在信息不完备下行动。

### 22. 规划谬误

- id: `planning-fallacy`
- type: `lens`
- summary: 规划时容易只考虑顺利路径，从而低估时间和成本。
- trigger:
  - 项目估时
  - 执行计划过于乐观
  - 任务存在多个依赖
- transform:
  - 从内部计划视角切换到历史基准和失败路径
- agent_instruction: |
  列出依赖、等待、返工和失败路径；参考类似任务的实际工期；给出基准、乐观和悲观估计。

### 23. 笛卡尔思维模型

- id: `cartesian-method`
- type: `procedure`
- summary: 怀疑前提，拆解复杂问题，逐步重组并进行完整检验。
- trigger:
  - 问题复杂且混乱
  - 需要系统拆解
  - 多个前提未经检查
- transform:
  - 怀疑→拆解→重组→检验
- agent_instruction: |
  先列出待验证的前提；把问题拆成可处理模块；从简单部分开始逐步重组；最后检查遗漏、矛盾和验证证据。

### 24. 无知之幕

- id: `veil-of-ignorance`
- type: `operator`
- summary: 在不知道自己会处于哪个位置时设计规则，以降低立场偏置。
- trigger:
  - 制度/规则设计
  - 多方利益冲突
  - 当前立场影响公平判断
- transform:
  - 暂时移除自身身份与既得利益
- agent_instruction: |
  假设你不知道自己最终会属于哪一方；重新设计规则，检查不同位置的人能否接受其风险、权利和收益分配。

### 25. 第一性原理

- id: `first-principles`
- type: `operator`
- summary: 把问题拆到不可再简化的基础事实和约束，再从这些基础重新推导方案。
- source_note: 原文仅在“心智模型”列表中出现名称；定义需后续补充正式来源。
- trigger:
  - 问题被既有做法限制
  - 大量行业惯例被当作前提
  - 需要重新建模
- transform:
  - 去掉类比和惯例
  - 从基础事实重新推导
- agent_instruction: |
  区分事实、假设和惯例；保留不可绕过的基础事实与约束；从这些基础重新构建结论或方案。

### 26. 逆向思维

- id: `inversion`
- type: `operator`
- summary: 从失败、反面结果或不希望发生的状态倒推原因和行动。
- source_note: 原文仅在“心智模型”列表中出现名称；定义需后续补充正式来源。
- trigger:
  - 风险分析
  - Review
  - 正向方案陷入惯性
- transform:
  - 从“如何成功”切换到“如何失败”
- agent_instruction: |
  先假设目标最终失败；列出最可能导致失败的条件、路径和信号；再反推需要避免、监控或提前验证的事项。

### 27. 第二层思维

- id: `second-order-thinking`
- type: `operator`
- summary: 继续追问直接结果之后会发生什么，分析二阶与后续反馈。
- source_note: 原文仅在“心智模型”列表中出现名称；定义需后续补充正式来源。
- trigger:
  - 分析只到直接影响
  - 方案看起来局部正确
  - 需要评估连锁反应
- transform:
  - 从一阶结果扩展到后续行为与反馈
- agent_instruction: |
  列出当前行动的一阶结果；对每个结果继续追问“然后呢”；至少推演到第二层后果，并关注反馈回路和行为适应。

### 28. 理解世界的三个层次：事件、局势、结构

- id: `event-conjuncture-structure`
- type: `procedure`
- summary: 把现象分别放到短期事件、中期局势和长期结构三个时间尺度观察。
- source_note: 原文“心智模型”列表中出现名称；具体方法需后续补充正式来源。
- trigger:
  - 分析停留在新闻事件
  - 罗列事实但缺少趋势
  - 缺乏长期结构视角
- transform:
  - 扩大时间尺度
  - 区分短期噪音、中期趋势和长期约束
- agent_instruction: |
  分别分析：事件层发生了什么；局势层这些事件共同形成什么中期趋势；结构层哪些长期制度、技术、资源和组织约束决定趋势边界。

### 29. 安全边际

- id: `margin-of-safety`
- type: `operator`
- summary: 在关键假设、估计和资源配置中保留缓冲，避免轻微误差导致系统失败。
- source_note: 原文仅在“心智模型”列表中出现名称；定义需后续补充正式来源。
- trigger:
  - 估计不确定
  - 关键资源接近极限
  - 决策对单点假设敏感
- transform:
  - 从最佳情况设计切换到容错设计
- agent_instruction: |
  识别最敏感的假设和资源瓶颈；评估它们偏离预期时的影响；为时间、容量、成本或可靠性设置明确缓冲。

### 30. 古德哈特定律

- id: `goodharts-law`
- type: `lens`
- summary: 当指标变成目标，行为会围绕指标优化，从而削弱指标代表真实目标的能力。
- source_note: 原文在“软件工程的13条法则”中给出简述，并在“心智模型”列表再次出现。
- trigger:
  - KPI/评分/排行榜成为目标
  - 团队开始“刷指标”
  - 代理指标与真实结果偏离
- transform:
  - 区分目标与代理指标
  - 检查指标被博弈后的失真
- agent_instruction: |
  明确真实目标与当前指标的关系；列出参与者为提高指标可能采取的策略；检查这些策略是否会损害真实目标，并补充反作弊或多指标约束。

## 4. Candidate Packs

这些词条保留，但第一版默认不参与全局推荐。后续可以按任务领域启用。

### 证据与随机性候选包

- 希钦斯剃刀
- 大数定理
- 均值回归
- 赌徒谬误
- 热手谬误
- 蒙特卡洛法
- 本福特定律
- 科赫法则

### 软件工程候选包

- Brooks 法则
- 帕金森定律
- 霍夫斯塔特定律
- 康威定律
- 海勒姆定律
- 墨菲定律
- 吉尔布定律
- 冗余备份模型

### 群体与信息环境候选包

- 回音室效应
- 群体极化
- 网络巴尔干化
- 社交蒸发冷却效应
- 死海效应
- 真相错觉效应

### 认知偏差候选包

- 巴纳姆效应
- 自证陷阱
- 一致性理论
- 认知失调
- 首因效应
- 邓宁-克鲁格效应
- 频率错觉
- 零风险偏差
- 展望理论
- 非 SR

## 5. Archive / 默认不进入推荐池

这些词条更偏具体知识、描述性效应或适用场景过窄。建议保留在原始知识库，不进入 MVP Method Registry：

- 税收楔子
- 马太效应
- 赌徒输光定理
- 破窗效应
- Alchian-Allen 定理
- 罗卡定律
- 习得性无助
- 本·富兰克林效应
- 蔡加尼克效应
- 曼德拉效应
- 登门槛效应
- 皮格马利翁效应
- 吊桥效应
- 情绪归因理论
- 瀑布心理效应
- 韵律当理由效应
- 皮糙肉厚偏见
- 优绩主义陷阱
- 二律背反
- 佩托悖论
- 现代达尔文综合模型
- 科技三定律

## 6. 后续补充优先级

### P0：补正式定义与来源

原文只出现名称、缺少正文定义，但又属于核心能力的词条：

- 第一性原理
- 逆向思维
- 第二层思维
- 理解世界的三个层次：事件、局势、结构
- 安全边际
- 古德哈特定律（已有简述，建议补完整条目）

### P1：把 Core Method 继续补齐产品字段

建议下一轮增加：

- `avoid_when`：什么时候不要推荐
- `positive_signals`：强触发信号
- `counter_signals`：抑制推荐信号
- `examples`：真实对话示例
- `related_methods`：相关方法
- `conflicts_with`：容易产生冲突的方法
- `recipe_tags`：可组成哪些 Recipe

## 7. Skill 推荐时的最小卡片

```yaml
id: occams-razor
name: 奥卡姆剃刀
type: operator
summary: 在解释力相近时，优先选择假设更少、结构更简单的解释。
trigger:
  - 回答冗余
  - 方案过度设计
  - 多个方案解释力相近
transform:
  - 删除无贡献复杂度
  - 提高信息密度
agent_instruction: >
  删除对核心结论没有贡献的假设、步骤和重复信息；
  保留关键事实、证据和必要因果链；
  效果相近时优先选择更简单的表达或方案。
```

## 8. 推荐策略建议

- 默认最多推荐 1~3 个 Method。
- 允许返回 `none`。
- Core 全局参与推荐；Candidate Pack 按任务领域加载。
- Archive 仅供人工浏览或未来重新评估。
- Skill 优先判断“当前缺失什么思维工具”，而不是做单纯关键词匹配。
