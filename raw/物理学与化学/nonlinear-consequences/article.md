---
id: nonlinear-consequences
name: 非线性后果
siyuan_id: 20261123000127-4a9c76f
description: 非线性后果揭示了输入与输出之间的非比例关系——泰坦尼克号速度仅增50%但制动距离增125%，人类直觉的线性假设在非线性世界中会导致灾难性误判。
aliases:
  - Nonlinear Consequences
  - 非线性效应
sources:
  - assets/source-6f9e32aff4d97f3bcf518e1544a2cbb5.md
---

## 核心理解

输入增加一倍，输出未必跟着增加一倍；局部斜率还可能随状态变化。先在两个以上区间取样，画出输入与输出，寻找饱和、阈值和反馈造成的斜率变化。

## 适用情境


小幅增加输入却带来过大或过小的后果，线性外推可能失真。


## 编辑示例与边界


固定数量的服务台在低负荷时新增一位顾客几乎不用等，接近满负荷后小幅增量就可能带来长队。排班时要看高峰到达分布，不能把低负荷时测得的线性关系任意外推。


## 参考资料


邦比快跑《Munger Models》，第106章《非线性后果》。


## 相关模型


- [复利效应](../../%E6%95%B0%E5%AD%A6%E4%B8%8E%E7%BB%9F%E8%AE%A1%E5%AD%A6/compound-interest/article.md) — 固定正利率下，下一期利息随当前本金变大，经过相同时间增加的金额也会变大。
  
- [临界质量](../critical-mass/article.md)是非线性转折的一种特殊情形：量变到质变。
  
- [相变与临界现象](../phase-transitions/article.md) — 相变附近，控制参数的微小变化可引起宏观状态的显著变化；一般曲线有拐弯不足以证明发生相变。
  
- [自组织临界性](../../%E5%A4%8D%E6%9D%82%E7%B3%BB%E7%BB%9F%E4%B8%8E%E5%86%B3%E7%AD%96%E7%A7%91%E5%AD%A6/self-organized-criticality/article.md) — 系统在临界态附近展现出极端的非线性响应。
  
- [安全边际](../../%E6%8A%95%E8%B5%84%E5%AD%A6%E4%B8%8E%E9%87%91%E8%9E%8D%E5%AD%A6/margin-of-safety/article.md) — 估算安全余量时，应检查工作点附近的斜率和极端情景；同样大的输入误差，在不同工作区间可能造成不同损失。
  
- [Lollapalooza倾向](../../%E5%BF%83%E7%90%86%E5%AD%A6/lollapalooza-tendency/article.md) — 奖惩或同伴压力单独出现时的反应，未必能相加得到两者同时出现时的反应；可比较单独与联合条件。
  
- [叠加原理与涌现](../superposition-and-emergence/article.md) — 在线性系统内，可把各输入的响应相加。若单独测试各部分无法解释组合后的响应，应检查相互作用项。
  
- [反馈环](../feedback-loops/article.md)中若放大系数会随状态而变化，同样的外部输入可在不同起点产生不同幅度的反应。应识别饱和或阈值，不能仅凭存在反馈就判定系统非线性。
  
- 非线性互动是[涌现](../../%E5%A4%8D%E6%9D%82%E7%B3%BB%E7%BB%9F%E4%B8%8E%E5%86%B3%E7%AD%96%E7%A7%91%E5%AD%A6/emergence/article.md)的核心机制。
  
- [脆弱性与反脆弱性](../../%E5%A4%8D%E6%9D%82%E7%B3%BB%E7%BB%9F%E4%B8%8E%E5%86%B3%E7%AD%96%E7%A7%91%E5%AD%A6/fragility-antifragility/article.md) — 若冲击强度增大一倍而损失增幅超过一倍，便有理由检查该区间的脆弱性。
