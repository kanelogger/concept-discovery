---
id: bayesian-updating
name: 贝叶斯更新
siyuan_id: 20261123000138-1eeabb9
description: 不是对错而是校准——面对新证据按比例调整信念概率，既不顽固拒绝改变也不在一条坏消息面前完全崩溃，这是不确定世界中修正判断的操作系统。
aliases:
  - Bayesian Updating
  - 贝叶斯信念更新
sources:
  - assets/source-b5336740f329593a150d7136ed9e6831.md
---

## 核心理解

给某项判断一个起始概率，每次有新资料时，比较这些资料在两种解释下分别有多常见。真正意外且能区分解释的证据应带来较大调整；若两种解释都能预料它，调整幅度宜小。

## 适用情境


连续收到新证据时，需要随证据强弱逐步调整原有判断。


## 编辑示例与边界


先估订单迟交概率20%，即赔率1比4。若供应商预警在迟交情形下出现的概率是按时情形的三倍，更新后赔率为3比4，概率约43%。重复转发同一条预警没有带来三份独立证据。


## 参考资料


邦比快跑《Munger Models》，第162章《贝叶斯更新》。


## 相关模型


- [贝叶斯定理](../../%E6%95%B0%E5%AD%A6%E4%B8%8E%E7%BB%9F%E8%AE%A1%E5%AD%A6/bayes-theorem/article.md)给出一次更新的计算规则。连续取得证据时，可用上次后验作新先验，并按新证据的条件似然继续更新。
  
- [避免不一致性倾向](../../%E5%BF%83%E7%90%86%E5%AD%A6/inconsistency-avoidance-tendency/article.md) — 贝叶斯更新最大的心理学敌人：选择性处理证据。
  
- [避免不一致性倾向](../../%E5%BF%83%E7%90%86%E5%AD%A6/inconsistency-avoidance-tendency/article.md) — 若已经公开坚持旧结论，可能轻视新的反面证据。可在看到结果前写下哪些观察会明显改变判断。
  
- [逆向思考](../../%E5%85%83%E8%AE%A4%E7%9F%A5%E4%B8%8E%E6%80%9D%E7%BB%B4%E6%96%B9%E6%B3%95%E8%AE%BA/inversion/article.md) — 主动寻找能大幅更新信念的反面证据。
  
- 在[能力圈](../../%E6%8A%95%E8%B5%84%E5%AD%A6%E4%B8%8E%E9%87%91%E8%9E%8D%E5%AD%A6/circle-of-competence/article.md)内做精细更新，在能力圈外保持保守先验。
  
- [回归均值](../../%E6%95%B0%E5%AD%A6%E4%B8%8E%E7%BB%9F%E8%AE%A1%E5%AD%A6/regression-to-the-mean/article.md) — 多层贝叶斯模型可利用群体数据把个体的噪声估计向群体水平收缩。收缩强度由群体差异和测量误差共同决定。
  
- 新证据改变相关假设的可信度时，可更新[决策树](../../%E6%95%B0%E5%AD%A6%E4%B8%8E%E7%BB%9F%E8%AE%A1%E5%AD%A6/decision-tree-theory/article.md)相应节点的概率，再重估各策略的收益。
  
- [自视过高的倾向](../../%E5%BF%83%E7%90%86%E5%AD%A6/excessive-self-regard-tendency/article.md) — 过度自信可能表现为先验分布过窄，或低估反证的诊断力；偏差的方向未必是把某个事件的概率估得更高。
