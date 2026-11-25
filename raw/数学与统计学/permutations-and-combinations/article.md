---
id: permutations-and-combinations
name: 排列组合原理
siyuan_id: 20261123000119-d285c56
description: 排列组合原理揭示了多环节串联系统的概率衰减效应——当一个计划需要多个独立环节全部成功时，整体成功率远低于任何单一环节的成功率。
aliases:
  - Permutations and Combinations
  - 排列组合
sources:
  - assets/source-685c2ad7915ada5f89a109c292e25d5b.md
---

## 核心理解

计数前先问顺序是否重要、是否允许重复。五个人选两名代表有5×4÷2＝10组；若分别担任主持和记录，角色有别，就有5×4＝20种安排。

## 适用情境


需要计算若干次选择的可能结果，且顺序、重复与互斥条件容易混淆。


## 编辑示例与边界


多环节方案可用树形列举避免漏掉分支，再给每条路加概率。只有基本结果等可能，才能直接用有利情况数除以总数。某些安排因资格限制不可行，应先从样本空间排除。


## 参考资料


邦比快跑《Munger Models》，第66章《排列组合原理》。


## 相关模型


- [复利效应](../compound-interest/article.md) — 列举各期收益出现的不同路径，再对每条路径连乘收益因子，可以比较同一策略下可能的最终财富。
  
- 排列组合提供结构，[概率思维](../probabilistic-thinking-expected-value/article.md)提供评估框架。
  
  
  
- [安全边际](../../%E6%8A%95%E8%B5%84%E5%AD%A6%E4%B8%8E%E9%87%91%E8%9E%8D%E5%AD%A6/margin-of-safety/article.md) — 在联合概率不高时为自己留足容错空间。
  
- [反过来想](../../%E5%85%83%E8%AE%A4%E7%9F%A5%E4%B8%8E%E6%80%9D%E7%BB%B4%E6%96%B9%E6%B3%95%E8%AE%BA/inversion/article.md)：哪个环节最可能失败？先解决它。
  
- [能力圈](../../%E6%8A%95%E8%B5%84%E5%AD%A6%E4%B8%8E%E9%87%91%E8%9E%8D%E5%AD%A6/circle-of-competence/article.md) — 描出一项判断所依赖的各个环节，把缺乏可靠资料或专业经验的环节标出来。
  
- [Lollapalooza倾向](../../%E5%BF%83%E7%90%86%E5%AD%A6/lollapalooza-tendency/article.md) — 多种偏差可能同时出现；排列组合可帮助列出其搭配，作用是否放大还得另找证据。
