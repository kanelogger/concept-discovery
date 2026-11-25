---
id: tight-coupling-loose-coupling
name: 紧耦合与松耦合
siyuan_id: 20261123000134-5221485
description: 同样的地震海啸下福岛核电站堆芯熔毁而120公里外的女川核电站安然无恙——差别不在运气而在系统的耦合度，紧耦合系统留给人类干预的时间几乎为零。
aliases:
  - Tight Coupling & Loose Coupling
  - 紧耦合与松耦合系统
  - Tight vs. Loose Coupling
sources:
  - assets/source-576dd646ed7cd0e8daf7de3090fdaa87.md
---

## 核心理解

紧耦合意味着部件依赖特定顺序、时间或资源，出问题时来不及隔离。松耦合通过缓冲、可替换接口和独立排程给恢复留出时间。把依赖画成图，观察哪里一停就立即拖住下游。

## 适用情境


一个单元出故障便迅速波及其他单元，需要评估缓冲和隔离。


## 编辑示例与边界


印刷与装订之间留有半天合格半成品，印刷机短暂停机时装订仍可继续。缓冲占用库存，还会推迟发现上游质量问题，容量要与恢复时间和反馈速度一起设计。


## 参考资料


邦比快跑《Munger Models》，第142章《紧耦合与松耦合》。


## 相关模型


- [正常事故](../normal-accidents/article.md)理论关注复杂交互与紧耦合并存的系统：隐蔽故障容易串联，留给操作人员的处置时间又短。
  
- [容错设计与优雅降级](../fault-tolerance/article.md) — 组件间有缓冲、独立接口或替代路径时，故障较容易隔离；还需检验共享电源、数据库等共同依赖。
  
- [冗余与备份](../redundancy/article.md) — 独立的备用路径可减少上下游对同一部件的依赖；真正解耦还要检验时限、接口及共享资源。
  
- 紧耦合缩短故障后的处置时间；是否存在[单点故障](../single-point-of-failure/article.md)则取决于有无替代路径，两项需分别评估。
  
- 松弛和缓冲是工程版本的[安全边际](../../%E6%8A%95%E8%B5%84%E5%AD%A6%E4%B8%8E%E9%87%91%E8%9E%8D%E5%AD%A6/margin-of-safety/article.md)。
  
- [规模效应与反效应](../scaling-effects-diseconomies-in-engineering/article.md) — 规模扩大时如何保持适度的松耦合是关键挑战。
  
- [脆弱性与反脆弱性](../../%E5%A4%8D%E6%9D%82%E7%B3%BB%E7%BB%9F%E4%B8%8E%E5%86%B3%E7%AD%96%E7%A7%91%E5%AD%A6/fragility-antifragility/article.md) — 松耦合有助限制扰动传播。要说系统能因扰动获益，须另有可验证的学习、调整或选择机制。
  
  
- [涌现性](../../%E5%A4%8D%E6%9D%82%E7%B3%BB%E7%BB%9F%E4%B8%8E%E5%86%B3%E7%AD%96%E7%A7%91%E5%AD%A6/emergence/article.md) — 接口紧密且缺少缓冲时，局部偏差可能很快牵连其他部件；传播是否形成整体失效，还取决于网络结构。
  
- 紧耦合系统中的一次崩溃可能彻底重置[复利](../../%E6%95%B0%E5%AD%A6%E4%B8%8E%E7%BB%9F%E8%AE%A1%E5%AD%A6/compound-interest/article.md)链条。
  
  
- [逆向思考](../../%E5%85%83%E8%AE%A4%E7%9F%A5%E4%B8%8E%E6%80%9D%E7%BB%B4%E6%96%B9%E6%B3%95%E8%AE%BA/inversion/article.md) — 松耦合设计的起点：问“什么会让整个系统崩溃”，然后在那里加入缓冲。
  
- [概率思维与期望值](../../%E6%95%B0%E5%AD%A6%E4%B8%8E%E7%BB%9F%E8%AE%A1%E5%AD%A6/probabilistic-thinking-expected-value/article.md) — 估算多个部件共同失效的概率时，须把共享资源、依赖次序等计入；把相依故障当成独立事件会误判尾部损失。
  
- [社会认同倾向](../../%E5%BF%83%E7%90%86%E5%AD%A6/social-proof-tendency/article.md) — 高度相连的金融机构中，看到别人在撤离会引发新的撤离，使局部恐慌迅速传到其他机构。
