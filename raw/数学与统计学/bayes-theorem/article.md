---
id: bayes-theorem
name: 贝叶斯定理
siyuan_id: 20261123000117-c9e896c
description: 贝叶斯定理揭示了新证据必须在先验概率背景下解读的核心逻辑，它从根本上改变你处理信息、更新判断和避免基础比率忽视的方式。
aliases:
  - Bayes' Theorem
  - 贝叶斯公式
sources:
  - assets/source-5ee9587cd6cf162d75187b54d1e1f70b.md
---

## 核心理解

贝叶斯定理给出证据出现后如何改写判断。用赔率表示，后验赔率＝先验赔率×似然比。似然比比较“假说为真时见到该证据”与“假说为假时见到该证据”的概率。

## 适用情境


取得一项新证据后，需要把它放回原先的发生率中理解。


## 编辑示例与边界


仓库有1%包裹错发，系统能发现90%错发，并误报3%正确包裹。每万件约有90个真警报和297个误报，警报后错发概率约23%。若两条警报来自同一传感器，不宜当独立证据连乘。


## 参考资料


邦比快跑《Munger Models》，第59章《贝叶斯定理》。


## 相关模型


- [决策树](../decision-tree-theory/article.md) — 新证据到来时，更新它能区分的分支概率，再计算后续选项的期望收益。
  
- [大数定律](../law-of-large-numbers/article.md) — 若先验来自历史频率，有代表性的重复观察能提高该频率估计的精度；模型假设及历史数据能否迁移也会影响先验质量。
  
- [避免不一致性倾向](../../%E5%BF%83%E7%90%86%E5%AD%A6/inconsistency-avoidance-tendency/article.md) — 即使新证据更支持另一解释，人也可能因不愿改口而保留旧判断；可先记录什么证据足以改变结论。
  
- [避免不一致性倾向](../../%E5%BF%83%E7%90%86%E5%AD%A6/inconsistency-avoidance-tendency/article.md) — 人们倾向于寻找和重视支持现有信念的证据，忽略反面证据。
  
- [社会认同倾向](../../%E5%BF%83%E7%90%86%E5%AD%A6/social-proof-tendency/article.md) — 多人重复同一消息时，先查消息来源是否独立，再决定应将它作为几份证据。
  
- [逆向思考](../../%E5%85%83%E8%AE%A4%E7%9F%A5%E4%B8%8E%E6%80%9D%E7%BB%B4%E6%96%B9%E6%B3%95%E8%AE%BA/inversion/article.md) — 将同一证据放进相反假设：如果两种假设都很容易产生它，就不应据此大幅更新。
  
- [奖励和惩罚超级反应倾向](../../%E5%BF%83%E7%90%86%E5%AD%A6/reward-and-punishment-superresponse-tendency/article.md) — 激励机制会扭曲你对证据的评估。
  
- [能力圈](../../%E6%8A%95%E8%B5%84%E5%AD%A6%E4%B8%8E%E9%87%91%E8%9E%8D%E5%AD%A6/circle-of-competence/article.md) — 在你有知识优势的领域，你的先验更可靠。
