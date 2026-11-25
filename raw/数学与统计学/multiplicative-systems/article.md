---
id: multiplicative-systems
name: 乘法系统思维
siyuan_id: 20261123000118-65d58ca
description: 乘法系统思维揭示了串联系统的残酷算术——当成功要求每个环节都成功时，总成功率是各环节概率的乘积，衰减速度远超直觉预期。
aliases:
  - Multiplicative Systems
  - 链式概率
  - 乘法思维
sources:
  - assets/source-334b770962bfebff24442adbdceeb362.md
---

## 核心理解

目标必须经过一连串关口时，全程成功率是每个关口在前面已成功的条件下的通过率之积。五道独立且通过率各90%的关口，全过约59%。某道必经关口降为零，整条路就断了。

## 适用情境


总结果要求多个必要条件同时满足，其中至少一项容易被忽略。


## 编辑示例与边界


提升报名转化前先拆解访问、填写、验证、到账各环节。改进哪一段要考虑提升空间、覆盖量与成本。若统计的是各环节的无条件比例，不能默认它们独立后直接相乘。


## 参考资料


邦比快跑《Munger Models》，第62章《乘法系统思维》。


## 相关模型


- [概率思维与期望值](../probabilistic-thinking-expected-value/article.md) — 每个环节都须成功的任务，可把各环节在先前环节成功条件下的成功概率相乘，再把结果纳入期望值。
  
- [排列组合原理](../permutations-and-combinations/article.md) — 先列出哪些故障组合会使系统失效。只有部件独立时才能直接相乘各自的边际概率。
  
- [冗余与备份](../../%E5%B7%A5%E7%A8%8B%E5%AD%A6/redundancy/article.md) — 冗余是对抗乘法衰减的核心工程策略：用并联替代串联。
  
- [安全边际](../../%E6%8A%95%E8%B5%84%E5%AD%A6%E4%B8%8E%E9%87%91%E8%9E%8D%E5%AD%A6/margin-of-safety/article.md)为乘法链条中的估算误差提供缓冲。
  
- [能力圈](../../%E6%8A%95%E8%B5%84%E5%AD%A6%E4%B8%8E%E9%87%91%E8%9E%8D%E5%AD%A6/circle-of-competence/article.md)可用来定位哪一段推断缺少可靠依据；即使只有一个环节，也可能超出判断能力。
  
- [复利效应](../compound-interest/article.md) — 把每期收益加回本金时，期末本金等于起始本金乘以各期收益因子的乘积。固定正收益率才给出标准的指数增长。
  
- 乘法链条中最弱的环节就是系统的潜在[断裂点](../../%E5%B7%A5%E7%A8%8B%E5%AD%A6/breakpoints/article.md)。
