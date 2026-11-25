---
id: design-for-maintainability
name: 可维护性设计
siyuan_id: 20261123000136-d3df182
description: F-104战斗机和平时期坠毁比战斗中被击落还多，根源是维护性设计的灾难——系统的长期价值不取决于最佳状态下能做什么，而取决于维护修复的难度。
aliases:
  - Design for Maintainability
  - 面向维护的设计
sources:
  - assets/source-8c4f64011fcb48b7e75a246112bde5ee.md
---

## 核心理解

可维护性决定系统出问题后定位、接近、替换和复验的难度。设计评审时实际走一遍常见维护任务，测从发现异常到恢复可用所需的时间与工具。

## 适用情境


设备迟早要修，需要在设计阶段缩短定位、拆换与验证所需时间。


## 编辑示例与边界


展柜灯泡寿命相同，能从前门更换的方案可减少拆柜和闭馆时间。但快拆接口若增加松脱风险，就应连同可靠性一起权衡。购买价仅是全寿命成本的一部分。


## 参考资料


邦比快跑《Munger Models》，第152章《可维护性设计》。


## 相关模型


- [容错设计与优雅降级](../fault-tolerance/article.md) — 容错问故障时能否继续提供功能，可维护性问能否查明问题并修复。备用模块能先维持服务，易更换的设计有助恢复完整能力。
  
- 可维护性设计通过模块化来减少[单点故障](../single-point-of-failure/article.md)的影响。
  
  
- [自动化与检查清单](../automation-checklists/article.md) — 检查清单是降低维护门槛的标准工具。
  
- [规模效应与反效应](../scaling-effects-diseconomies-in-engineering/article.md) — 设备规模扩大后，维护窗口、可替换零件和隔离范围可能成为瓶颈。可在改变规模前分别测量。
  
- [能力圈](../../%E6%8A%95%E8%B5%84%E5%AD%A6%E4%B8%8E%E9%87%91%E8%9E%8D%E5%AD%A6/circle-of-competence/article.md) — 选择自己能够理解和“维护”的投资对象。
