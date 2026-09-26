# 50 条评测草案人工复核表

**全部由 Assistant 编写，人工复核数 0，真实日志案例数 0。** 中英文各 25 条；40 条正例（其中 6 条多 Concept），10 条 NONE。英文场景有独立细节，但与中文共用 20 个正例主题，不能把 50 条当成 50 个独立问题域。

请逐条核对任务、Expected 和理由；修改 Expected 时也同步 `eval.cases.draft.json`。最后记录复核人、日期及修改。当前原始资料中存在泛化和出处不明确内容，推荐命中不等于其知识主张已被验证。正式版本还需用 25 条脱敏真实任务替换对应草案，保留 25 条经人工复核的典型场景，并冻结来源比例、语言比例和标签。

| ID | 语言 | 任务 | Expected | 标注理由 | 人工结论 |
| --- | --- | --- | --- | --- | --- |
| cn-testable-claim | cn | 团队说某项增长策略无论成功、失败还是没有变化都证明策略正确。我想在试点前写出什么可观察结果会让我们放弃这个说法。 | falsifiability | 任务要求提出可能推翻主张的观察结果。 | 待复核 |
| en-testable-claim | en | A vendor says its training program works, but explains every disappointing result as evidence that more training is needed. Help me define an observation that would count against the claim before a pilot. | falsifiability | 任务要求提出可能推翻主张的观察结果。 | 待复核 |
| cn-beginner-explanation | cn | 我给刚入职、从未接触这个系统的同事讲操作流程，自己觉得简单，对方却连第一步的术语都看不懂。请帮我找出讲解中默认对方已知的前提并重写。 | curse-of-knowledge | 核心是讲解者未能还原初学者的知识状态。 | 待复核 |
| en-beginner-explanation | en | I wrote onboarding instructions for volunteers who have never used our scheduling tool. They stop at terms I thought were obvious. Help me identify assumed background knowledge and explain the first steps. | curse-of-knowledge | 核心是讲解者未能还原初学者的知识状态。 | 待复核 |
| cn-missing-failures | cn | 我们只访谈了成功续费的客户，就认定所有客户都喜欢复杂功能。流失客户和没有完成试用的人没进访谈名单。请检查这个结论的样本缺口。 | survivorship-bias | 观察集合排除了退出或失败者。 | 待复核 |
| en-missing-failures | en | Our report studies only startups still operating after five years and concludes that their early habits guarantee success. We have no records for firms that closed. Help me identify the missing evidence. | survivorship-bias | 观察集合排除了退出或失败者。 | 待复核 |
| cn-single-point-failure | cn | 内部文档只有一台服务器保存，停机后所有人都无法工作。请为关键文件设计多个独立副本、恢复演练和单点故障的替代路径。 | redundancy-backup | 需要独立副本及可恢复性，不能只复制到同一故障域。 | 待复核 |
| en-single-point-failure | en | Our workshop has one copy of every machine configuration on a single laptop. Design independent backups and a tested recovery path so a lost laptop cannot halt production. | redundancy-backup | 需要独立副本及可恢复性，不能只复制到同一故障域。 | 待复核 |
| cn-uncertain-inputs | cn | 活动人数可能在 80 到 180 之间，单人耗材和到货延迟也有分布。没有简单解析公式，我想反复抽样模拟总成本，估计超预算的比例。 | monte-carlo-method | 给定分布并通过反复随机抽样估计结果。 | 待复核 |
| en-uncertain-inputs | en | A warehouse model has uncertain daily demand, repair time, and delivery delay. I have estimated distributions and want repeated random simulations to estimate the chance of running out of stock. | monte-carlo-method | 给定分布并通过反复随机抽样估计结果。 | 待复核 |
| cn-fewer-assumptions | cn | 一次故障有两个解释，都能解释目前日志。A 只需一个已经观测到的配置错误，B 还要假设三个没有证据的同时故障。帮我比较先检验哪种解释。 | occams-razor | 解释力相当时，优先更少额外假设并保留验证。 | 待复核 |
| en-fewer-assumptions | en | Two explanations fit a printer failure. One uses a loose cable we observed; the other assumes several unseen software faults at once. Help prioritize a test while keeping both explanations falsifiable. | occams-razor | 解释力相当时，优先更少额外假设并保留验证。 | 待复核 |
| cn-extraordinary-claim | cn | 有人宣称新装置完全不耗能却能持续输出电力，给出的证据只有一段剪辑视频。我需要设计与这一异常主张强度相匹配的证据要求。 | sagans-standard | 异常或极强主张需要相称的证据强度。 | 待复核 |
| en-extraordinary-claim | en | A supplier claims a storage device retains data forever with no failure under any conditions, supported only by a testimonial. Help specify the independent evidence such a sweeping claim would require. | sagans-standard | 异常或极强主张需要相称的证据强度。 | 待复核 |
| cn-structured-discussion | cn | 评审会上有人只讲风险，有人只讲愿景，有人只讲个人感受，讨论互相打断。请安排轮次，让所有人依次讨论事实、情感、风险、收益、创意和会议过程。 | six-thinking-hats | 要求参与者按共同思考模式依次讨论。 | 待复核 |
| en-structured-discussion | en | Our community committee mixes factual questions, worries, enthusiasm, and new ideas in the same argument. Design a discussion where everyone examines the same mode of thinking at each stage. | six-thinking-hats | 要求参与者按共同思考模式依次讨论。 | 待复核 |
| cn-fair-rules | cn | 我要设计轮班制度，自己也可能被分到资历最浅、通勤最远或照顾家人的任一位置。请先假设不知道自己将在哪个位置，再审查规则是否公平。 | veil-of-ignorance | 通过不知道自身位置来审查分配规则。 | 待复核 |
| en-fair-rules | en | We are setting access rules for a shared laboratory. Review them as if we did not know whether we would be a new researcher, a senior researcher, or someone with limited working hours. | veil-of-ignorance | 通过不知道自身位置来审查分配规则。 | 待复核 |
| cn-late-project-staffing | cn | 软件发布已经延迟，经理要立刻加入十名不熟悉代码的新同事。现有三位骨干还要培训和协调他们。请评估这种补救是否反而拖慢交付。 | brooks-law | 落后软件项目加人可能增加沟通和培训负担。 | 待复核 |
| en-late-project-staffing | en | A software migration is late. The proposed rescue doubles the team with engineers who need onboarding from the people on the critical path. Evaluate the coordination and training cost before we commit. | brooks-law | 落后软件项目加人可能增加沟通和培训负担。 | 待复核 |
| cn-organization-architecture | cn | 四个团队各自负责一个系统模块，接口边界恰好复制了部门边界，跨模块体验因此很差。请从沟通结构与系统结构的关系寻找改善办法。 | conways-law | 组织沟通边界与系统设计边界相互对应。 | 待复核 |
| en-organization-architecture | en | Our product consists of disconnected services that mirror reporting lines rather than user journeys. Help examine how communication between teams shapes those boundaries. | conways-law | 组织沟通边界与系统设计边界相互对应。 | 待复核 |
| cn-observable-api-behavior | cn | API 文档从未承诺结果排序，但大量客户已依赖现在的顺序。我们准备调整实现，想评估这种未写进文档的可观察行为是否也构成兼容性风险。 | hyrums-law | 使用者可能依赖任何稳定可观察行为。 | 待复核 |
| en-observable-api-behavior | en | A library has always returned errors with a particular string format, although the docs make no promise about it. Many clients parse that string. Plan a change that accounts for those dependencies. | hyrums-law | 使用者可能依赖任何稳定可观察行为。 | 待复核 |
| cn-target-distorts-metric | cn | 客服开始按关单数量发奖金，结果大家很快关单，客户又反复重开。请分析为什么原来衡量服务效率的指标变成考核目标后失真，并设计约束。 | goodharts-law | 指标成为激励目标后可能偏离原先测量目的。 | 待复核 |
| en-target-distorts-metric | en | A help center rewards agents for short calls. Average call time fell, but unresolved problems and repeat calls rose. Help redesign measurement so the target does not undermine the outcome. | goodharts-law | 指标成为激励目标后可能偏离原先测量目的。 | 待复核 |
| cn-pre-mortem | cn | 上线计划看起来都很乐观。我想先假设一个月后上线彻底失败，列出使失败成为必然的条件，再把这些条件转成今天的检查项。 | inversion | 从失败结果反推条件，再转成预防动作。 | 待复核 |
| en-pre-mortem | en | Before opening a new community service, assume it has failed badly after a month. Work backward to identify preventable conditions that would cause that failure and turn them into checks. | inversion | 从失败结果反推条件，再转成预防动作。 | 待复核 |
| cn-downstream-effects | cn | 取消审核可以立刻缩短交付时间，但可能改变返工、信任和后续流程。我想逐层追问直接结果发生后还会引起什么变化。 | second-order-thinking | 任务关注直接效果之后的连锁结果。 | 待复核 |
| en-downstream-effects | en | Removing appointment limits could improve access immediately, but may change waiting time, staff workload, and future demand. Trace consequences beyond the first benefit. | second-order-thinking | 任务关注直接效果之后的连锁结果。 | 待复核 |
| cn-rebuild-from-constraints | cn | 采购团队只按同行现成报价估计设备成本。我想先列出必须满足的物理功能、材料和制造约束，再从这些基本事实重新构建可行方案。 | first-principles | 从基本事实和约束重建方案，避免只沿用类比。 | 待复核 |
| en-rebuild-from-constraints | en | Our packaging design copies competitors by habit. Rebuild the design from required protection, shipping constraints, material properties, and manufacturing limits before comparing existing solutions. | first-principles | 从基本事实和约束重建方案，避免只沿用类比。 | 待复核 |
| cn-recurring-structure | cn | 每次客户投诉我们都临时加班解决，但同类投诉连续六个月重复。我想区分单次事件、长期模式和背后的排班与激励结构，找到能减少复发的修改。 | three-levels-of-understanding | 需要从事件到模式，再到结构层寻找干预。 | 待复核 |
| en-recurring-structure | en | The same handoff failure recurs every quarter despite individual fixes. Separate incidents, recurring patterns, and underlying ownership and feedback structures before choosing an intervention. | three-levels-of-understanding | 需要从事件到模式，再到结构层寻找干预。 | 待复核 |
| cn-failure-and-buffer | cn | 一次发布窗口只有两小时。请先从发布失败倒推关键风险，再针对回滚耗时的不确定性预留明确缓冲；我需要这两个互补视角。 | inversion, margin-of-safety | 失败倒推与安全缓冲分别对应两个明确子任务。 | 待复核 |
| en-failure-and-buffer | en | A festival setup has a hard opening time. First work backward from a failed opening, then allocate buffers for uncertain setup duration and recovery. I need both failure analysis and reserve capacity. | inversion, margin-of-safety | 失败倒推与安全缓冲分别对应两个明确子任务。 | 待复核 |
| cn-metric-and-sample | cn | 培训项目按结业率发奖金，评估报告又只访问毕业学员。请分别检查激励指标是否诱发放水，以及未结业者被排除后对效果结论的影响。 | goodharts-law, survivorship-bias | 同时检查指标异化与只观察幸存样本。 | 待复核 |
| en-metric-and-sample | en | A support program rewards completion counts and measures satisfaction only among completers. Evaluate both gaming of the target and the exclusion of people who dropped out. | goodharts-law, survivorship-bias | 同时检查指标异化与只观察幸存样本。 | 待复核 |
| cn-shared-resource-governance | cn | 多个团队无限占用同一个有限 GPU 池。请依次分析共享资源为何被过度占用、在不知道自己属于大团队还是小团队时制定公平配额、再推演配额对排队和绕行行为的后续影响。 | tragedy-of-the-commons, veil-of-ignorance, second-order-thinking | 共享资源激励、公平规则与次级后果三个子任务均明确出现。 | 待复核 |
| en-shared-resource-governance | en | Several groups can reserve unlimited time on a finite shared telescope. Explain the overuse incentives, design rules without knowing which group we belong to, and trace how the rules may change future behavior. | tragedy-of-the-commons, veil-of-ignorance, second-order-thinking | 共享资源激励、公平规则与次级后果三个子任务均明确出现。 | 待复核 |
| cn-none-arithmetic | cn | 只给出计算结果：17 + 26。 | NONE | 直接计算、翻译、提取或格式转换；引入方法论对当前任务没有明显增益。 | 待复核 |
| cn-none-literal-translation | cn | 把这句话译成英文，只返回译文，不补充建议：我们已经准备好回滚步骤和独立备份。 | NONE | 直接计算、翻译、提取或格式转换；引入方法论对当前任务没有明显增益。 | 待复核 |
| cn-none-sort-values | cn | 把这些整数按从小到大排列，只返回数组：[7, 2, 9, 1]。 | NONE | 直接计算、翻译、提取或格式转换；引入方法论对当前任务没有明显增益。 | 待复核 |
| cn-none-extract-emails | cn | 从“联系人 a@example.com 和 b@example.com”中提取邮箱地址，每行一个，不补充说明。 | NONE | 直接计算、翻译、提取或格式转换；引入方法论对当前任务没有明显增益。 | 待复核 |
| cn-none-format-json | cn | 把键值 name=demo、enabled=true 写成合法 JSON，只返回 JSON。 | NONE | 直接计算、翻译、提取或格式转换；引入方法论对当前任务没有明显增益。 | 待复核 |
| en-none-arithmetic | en | Return only the result of 9 times 8. | NONE | 直接计算、翻译、提取或格式转换；引入方法论对当前任务没有明显增益。 | 待复核 |
| en-none-literal-translation | en | Translate into Chinese and return only the translation, without advice: Adding more engineers may delay an already late software project. | NONE | 直接计算、翻译、提取或格式转换；引入方法论对当前任务没有明显增益。 | 待复核 |
| en-none-sort-values | en | Sort these words alphabetically and return only the list: pear, apple, banana. | NONE | 直接计算、翻译、提取或格式转换；引入方法论对当前任务没有明显增益。 | 待复核 |
| en-none-extract-ids | en | Extract only the order IDs from this text, one per line: shipped order A-104 and pending order B-207. | NONE | 直接计算、翻译、提取或格式转换；引入方法论对当前任务没有明显增益。 | 待复核 |
| en-none-format-json | en | Convert title=note and count=3 into a JSON object. Return only valid JSON. | NONE | 直接计算、翻译、提取或格式转换；引入方法论对当前任务没有明显增益。 | 待复核 |
