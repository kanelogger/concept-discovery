---
id: normal-accidents
name: 正常事故
siyuan_id: 20261123000136-b2f1d9f
description: 三里岛核事故不是因为某人犯了愚蠢错误，而是系统太复杂太紧耦合——对于复杂且紧耦合的系统，灾难性事故不是异常而是统计必然。
aliases:
  - Normal Accidents
  - 正常事故理论
  - Normal Accident Theory
sources:
  - assets/source-9db8621e4bb23a78e94b02b6465d54d8.md
---

## 核心理解

“正常事故”理论指出，交互关系复杂且耦合紧密的系统，可能由多个平常的小异常组合成难以预见、来不及处理的后果。应检查信息可见性、隔离能力和可供人干预的时间。

## 适用情境


高度耦合、相互作用复杂的系统中，多件小故障可能意外组合。


## 编辑示例与边界


大型会场的签到、座位确认和入场闸口若必须实时同步，短暂延迟可能被各岗位同时误读为无票。清晰的离线状态和独立核验通道能减少连锁影响。该理论不能用来断言某起事故不可避免。


## 参考资料


邦比快跑《Munger Models》，第150章《正常事故》。


## 相关模型


- [紧耦合与松耦合](../tight-coupling-loose-coupling/article.md) — 耦合度是正常事故理论的核心维度之一。
  
- [容错设计与优雅降级](../fault-tolerance/article.md) — 容错设计是应对正常事故风险的工程策略。
  
- 复杂系统中的[单点故障](../single-point-of-failure/article.md)是正常事故的常见触发点。
  
- 紧耦合系统一旦到达[断裂点](../breakpoints/article.md)，恢复极为困难。
  
- [故障模式分析](../failure-mode-analysis/article.md) — 系统化识别潜在故障模式，是降低正常事故概率的方法。
  
- [安全边际](../../%E6%8A%95%E8%B5%84%E5%AD%A6%E4%B8%8E%E9%87%91%E8%9E%8D%E5%AD%A6/margin-of-safety/article.md) — 为“不可避免的意外”预留缓冲。
  
- [能力圈](../../%E6%8A%95%E8%B5%84%E5%AD%A6%E4%B8%8E%E9%87%91%E8%9E%8D%E5%AD%A6/circle-of-competence/article.md) — 不进入自己无法理解的复杂系统，是避免正常事故的芒格策略。
  
- [复杂适应系统](../../%E7%94%9F%E7%89%A9%E5%AD%A6%E4%B8%8E%E8%BF%9B%E5%8C%96%E8%AE%BA/complex-adaptive-systems/article.md) — 若系统中的参与者还能学习、调整策略，分析事故时应同时检查工程耦合和参与者对规则的适应。
  
- [脆弱性与反脆弱性](../../%E5%A4%8D%E6%9D%82%E7%B3%BB%E7%BB%9F%E4%B8%8E%E5%86%B3%E7%AD%96%E7%A7%91%E5%AD%A6/fragility-antifragility/article.md) — 正常事故理论关注复杂交互和紧耦合怎样限制故障处置。系统遇扰动会受损、恢复还是改善，还要考察具体暴露和恢复机制。
  
- [涌现性](../../%E5%A4%8D%E6%9D%82%E7%B3%BB%E7%BB%9F%E4%B8%8E%E5%86%B3%E7%AD%96%E7%A7%91%E5%AD%A6/emergence/article.md) — 多个部件各自的故障看似可控，却可能通过此前未料到的相互作用引发系统事故。分析时要重建交互次序。
  
- [逆向思考](../../%E5%85%83%E8%AE%A4%E7%9F%A5%E4%B8%8E%E6%80%9D%E7%BB%B4%E6%96%B9%E6%B3%95%E8%AE%BA/inversion/article.md) — “先假设会失败，然后倒推失败路径”是正常事故理论的决策应用。
  
- [检查清单](../../%E5%85%83%E8%AE%A4%E7%9F%A5%E4%B8%8E%E6%80%9D%E7%BB%B4%E6%96%B9%E6%B3%95%E8%AE%BA/checklist-method/article.md)在复杂系统中降低人为失误概率，但无法消除正常事故。
  
- 正常事故理论追踪复杂交互与时间依赖，[自组织临界](../../%E5%A4%8D%E6%9D%82%E7%B3%BB%E7%BB%9F%E4%B8%8E%E5%86%B3%E7%AD%96%E7%A7%91%E5%AD%A6/self-organized-criticality/article.md)模型解释某些扰动如何形成规模差异很大的级联；同一事故需分别检验两种机制。
