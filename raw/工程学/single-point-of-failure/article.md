---
id: single-point-of-failure
name: 单点故障
siyuan_id: 20261123000135-d850568
description: 一条错误命令瘫痪半个互联网——当整个系统的存亡取决于一个不可替代的环节时，那个环节的任何闪失都会转化为系统级灾难。
aliases:
  - Single Point of Failure
  - SPOF
  - 单一故障点
sources:
  - assets/source-19fd36a04d542fb452c42afb76de5ca5.md
---

## 核心理解

某一个部件、权限或角色单独失效，就能使整个关键功能停止，它就是单点故障。沿用户完成任务的路径追到共享依赖，再逐一问若该环节暂时不可用，还有没有实际能走通的路径。

## 适用情境


想知道哪个部件失效，哪怕其他部件正常，也足以停止整个服务。


## 编辑示例与边界


两位财务人员都会付款，但授权设备只在一位负责人手上，休假时两条人员路径同时失效。建立合规代理授权后应实际演练。备份存在却无法及时启用，单点仍未消除。


## 参考资料


邦比快跑《Munger Models》，第145章《单点故障》。


## 相关模型


- [冗余与备份](../redundancy/article.md) — 消除单点故障的核心手段：为关键环节构建备份。
  
- [FMEA](../failure-mode-analysis/article.md)是识别单点故障的系统化方法。
  
- 单个部件失效就足以中断整个功能，才是单点故障；系统的[断裂点](../breakpoints/article.md)也可能来自多个部件共同超载。
  
  
- [安全边际](../../%E6%8A%95%E8%B5%84%E5%AD%A6%E4%B8%8E%E9%87%91%E8%9E%8D%E5%AD%A6/margin-of-safety/article.md) — 增加载荷余量可能推迟部件过载。若部件突发失效仍会让全系统停摆，还须考虑替代路径或隔离。
  
- [紧耦合与松耦合](../tight-coupling-loose-coupling/article.md) — 紧耦合系统中的单点故障传导更快、后果更严重。
  
- [脆弱性与反脆弱性](../../%E5%A4%8D%E6%9D%82%E7%B3%BB%E7%BB%9F%E4%B8%8E%E5%86%B3%E7%AD%96%E7%A7%91%E5%AD%A6/fragility-antifragility/article.md) — 单点故障是系统脆弱性的典型表现。
  
- 识别单点故障的思维方式本质上就是[逆向思考](../../%E5%85%83%E8%AE%A4%E7%9F%A5%E4%B8%8E%E6%80%9D%E7%BB%B4%E6%96%B9%E6%B3%95%E8%AE%BA/inversion/article.md)。
