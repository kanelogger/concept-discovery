---
id: probabilistic-thinking-expected-value
name: 概率思维与期望值
siyuan_id: 20261123000117-cf7e4c0
description: 概率思维与期望值计算是芒格视为生存必备的决策工具，它将思考从二元的会不会发生升级为概率加权的期望值分析，是理性决策的及格线。
aliases:
  - Probabilistic Thinking & Expected Value
  - 概率决策
  - 概率思维
sources:
  - assets/source-fd60ef458b42e0ddcda8eb04c505d85b.md
---

## 核心理解

把“会不会”拆成互斥且覆盖主要可能的结果，分别估计概率与后果，再算加权平均。先做乐观、基准和悲观情形，可以看出结果究竟由哪一个估计主导。

## 适用情境


多个方案各有不同结果和发生概率，单看最好结果难以比较。


## 编辑示例与边界


试销成功概率三成，净赚一万元，失败净亏两千，期望为1600元。若机会只有一次、损失会中断运营，账面正期望仍不足以决定是否尝试；先考察可承受损失与估计误差。


## 参考资料


邦比快跑《Munger Models》，第58章《概率思维与期望值》。


## 相关模型


- [复利效应](../compound-interest/article.md) — 正期望描述一次决策的平均收益。反复下注时，财富取决于每次押注的比例及各期收益因子的连乘，仍可能缩水或归零。
  
- [排列组合原理](../permutations-and-combinations/article.md) — 若基本结果等可能，先数满足条件的排列或组合，再除以全部可能结果数，可得到事件概率；不等可能时还要按权重求和。
  
  
- [安全边际](../../%E6%8A%95%E8%B5%84%E5%AD%A6%E4%B8%8E%E9%87%91%E8%9E%8D%E5%AD%A6/margin-of-safety/article.md)是在概率估计可能出错时保护你的缓冲区。
  
- [逆向思考](../../%E5%85%83%E8%AE%A4%E7%9F%A5%E4%B8%8E%E6%80%9D%E7%BB%B4%E6%96%B9%E6%B3%95%E8%AE%BA/inversion/article.md) — 反过来算：亏损的概率和幅度是多少？期望值还是正的吗？
  
- [奖励和惩罚超级反应倾向](../../%E5%BF%83%E7%90%86%E5%AD%A6/reward-and-punishment-superresponse-tendency/article.md) — 若奖金随成交发放，推销者可能把成功概率说得过高；估算期望值时要查独立样本。
  
- [过度乐观倾向](../../%E5%BF%83%E7%90%86%E5%AD%A6/overoptimism-tendency/article.md) — 对未来过于乐观会使高收益分支的权重偏高，可用相似项目的实际成功率校准。
  
- [Lollapalooza倾向](../../%E5%BF%83%E7%90%86%E5%AD%A6/lollapalooza-tendency/article.md) — 高估胜率又低估亏损幅度，两项偏差会把同一个期望值一同推高。
  
- [基本算术与数量级估算](../basic-arithmetic-order-of-magnitude-estimation/article.md) — 判断期望值前，可先估算常见收益和罕见损失的数量级，检查是否遗漏了足以改变结论的小概率事件。
  
- [大数定律](../law-of-large-numbers/article.md) — 在独立同分布且期望绝对值有限等条件下，重复试验的样本平均数趋近总体期望。单次决策也能比较期望值。
  
- [不对称性与凸性](../asymmetry-convexity/article.md) — 当收益和损失不对称时，期望值计算需要特别注意。
  
- [被剥夺超级反应倾向](../../%E5%BF%83%E7%90%86%E5%AD%A6/deprival-superreaction-tendency/article.md) — 将各结果的金额和概率分别列出，再检查损失带来的情绪是否影响了对其发生概率的估计。
