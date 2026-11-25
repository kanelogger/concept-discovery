---
id: fault-tolerance
name: 容错设计与优雅降级
siyuan_id: 20261123000135-f3e45c7
description: Netflix每天故意在生产环境中杀死服务器却无用户感知异常——好的系统不追求永不出错，而是确保出错时功能逐步减少但核心仍然运转。
aliases:
  - Fault Tolerance and Graceful Degradation
  - 容错与降级
sources:
  - assets/source-bfc3b0b0aa9da1bb563a066315440038.md
---

## 核心理解

容错设计预先规定局部故障时哪些能力一定要保住、哪些可以暂时降低，以及怎样恢复。通过隔离依赖、暂存未完成工作和清楚标记状态，缩小故障的影响。

## 适用情境


局部故障时希望保住核心服务，同时明确可以临时放弃的功能。


## 编辑示例与边界


网络断开时，售票机可继续展示时刻并标出更新时间，售票暂停或按预定离线规则处理。恢复后核对库存和订单，避免重扣。数据过期会误导人员时，应明确失效或停止显示。


## 参考资料


邦比快跑《Munger Models》，第146章《容错设计与优雅降级》。


## 相关模型


- [冗余与备份](../redundancy/article.md) — 备份是实现容错的一种手段，还要能检测故障、切换并避免主备同因失效。
  
- 容错设计的目标之一就是消除或隔离[单点故障](../single-point-of-failure/article.md)。
  
- [安全边际](../../%E6%8A%95%E8%B5%84%E5%AD%A6%E4%B8%8E%E9%87%91%E8%9E%8D%E5%AD%A6/margin-of-safety/article.md)是投资领域的容错策略：为判断错误预留空间。
  
- 容错设计延迟甚至避免系统到达[断裂点](../breakpoints/article.md)。
  
- [脆弱性与反脆弱性](../../%E5%A4%8D%E6%9D%82%E7%B3%BB%E7%BB%9F%E4%B8%8E%E5%86%B3%E7%AD%96%E7%A7%91%E5%AD%A6/fragility-antifragility/article.md) — 故障后仍可维持服务属于容错。若还会根据故障经验改善后续表现，则可另行评估是否从扰动中获益。
  
- [紧耦合与松耦合](../tight-coupling-loose-coupling/article.md) — 部件间接口稳定又有缓冲时，局部故障较易隔离；依赖同一基础设施仍可能同时中断。
  
- [FMEA](../failure-mode-analysis/article.md)为容错设计提供系统化的故障识别方法。
  
- 容错设计的起点是[逆向思考](../../%E5%85%83%E8%AE%A4%E7%9F%A5%E4%B8%8E%E6%80%9D%E7%BB%B4%E6%96%B9%E6%B3%95%E8%AE%BA/inversion/article.md)：“什么会出错，出错后会怎样？”
