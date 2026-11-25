---
id: normal-non-normal-distributions
name: 正态与非正态分布
siyuan_id: 20261123000119-50504eb
description: 正态分布与肥尾分布的本质区别决定了极端事件的发生概率，LTCM的崩溃警示我们不能用钟形曲线的假设来建模真实世界的风险。
aliases:
  - Normal & Non-Normal Distributions
  - 正态分布与非正态分布
sources:
  - assets/source-25993cc6de9b58afa36247a34456a621.md
---

## 核心理解

正态分布左右对称，远离平均的极端值迅速变少。现实数据也可能偏斜、混合或厚尾；同一平均和方差不足以保证极端风险相同。先画分布，查看分位数与尾部个案。

## 适用情境


打算用均值和标准差估计异常值，先要核对分布是否偏斜或肥尾。


## 编辑示例与边界


少数超长通话能把客服平均时长明显拉高，排班可同时参考中位数与高分位。样本中没出现极端情形只说明尚未观察到，短历史尤其不适合精确估计极端频率。


## 参考资料


邦比快跑《Munger Models》，第67章《正态与非正态分布》。


## 相关模型


- [幂律](../power-laws/article.md)尾是一类非正态尾部。观察到极端值后，还应与对数正态等候选分布比较。
  
- 独立同分布且方差有限时，[大数定律](../law-of-large-numbers/article.md)描述样本均值靠近期望，中心极限定理描述其标准化波动趋近正态。
  
- [回归均值](../regression-to-the-mean/article.md) — 检验与复测的分数若近似联合正态且相关性小于一，极端初测者的平均复测分数通常更接近总体均值。
  
- [贝叶斯定理](../bayes-theorem/article.md) — 先验分布应符合参数的取值范围和已有知识。例如未知概率在零与一之间，可考虑 Beta 分布。
  
- [概率思维与期望值](../probabilistic-thinking-expected-value/article.md) — 遇到少数极大损失时，应检查拟合分布能否覆盖罕见结果，以及期望值是否有限。
  
- 在肥尾世界中，[安全边际](../../%E6%8A%95%E8%B5%84%E5%AD%A6%E4%B8%8E%E9%87%91%E8%9E%8D%E5%AD%A6/margin-of-safety/article.md)是对抗模型失灵的最后防线。
  
- [不对称性与凸性](../asymmetry-convexity/article.md) — 厚尾表示极端偏离更常见。对称的 t 分布也可以厚尾；实际盈亏是否不对称取决于左右尾和持仓方式。
  
- 厚尾会使均值估计不稳。有无[回归均值](../regression-to-the-mean/article.md)，仍取决于如何筛选对象、重复测量是否相关以及均值是否存在。
  
- [趋势外推的局限](../limits-of-extrapolation-nonlinearity/article.md) — 用正常时期的趋势外推极端时期的表现是经典错误。
  
- [非线性后果](../../%E7%89%A9%E7%90%86%E5%AD%A6%E4%B8%8E%E5%8C%96%E5%AD%A6/nonlinear-consequences/article.md) — 独立变量的线性和也可以呈非正态分布；非线性变换同样会改变分布形状。要辨别机制，需要观测或模型之外的证据。
