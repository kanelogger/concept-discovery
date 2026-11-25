---
id: failure-mode-analysis
name: 故障模式分析
siyuan_id: 20261123000135-e0aae75
description: 挑战者号航天飞机因一个已知的O型环故障被忽视而爆炸——系统性地在事前回答什么可能出错以及出错后会怎样，是工程学最重要的预防性思维工具。
aliases:
  - Failure Mode Analysis
  - FMEA
  - 故障模式与影响分析
sources:
  - assets/source-c241c758052a0237735abe83a098cadb.md
---

## 核心理解

故障模式与影响分析从功能出发，逐项列出可能怎样失效、会影响谁、原因是什么、现有控制怎样发现或预防。优先处理后果严重而又难以及时察觉的模式，指定负责人并验证改动。

## 适用情境


在产品交付前系统列出会怎样坏、后果多大、现有控制能否发现。


## 编辑示例与边界


预约提醒未送达可能是地址错误，也可能是投递失败。分别核实地址、监测退信并准备其他通知方式。仅靠风险评分排序会掩盖罕见但严重的情形，也容易遗漏多个故障共同发生。


## 参考资料


邦比快跑《Munger Models》，第147章《故障模式分析》。


## 相关模型


- FMEA是[逆向思维](../../%E5%85%83%E8%AE%A4%E7%9F%A5%E4%B8%8E%E6%80%9D%E7%BB%B4%E6%96%B9%E6%B3%95%E8%AE%BA/inversion/article.md)最系统化的实践形式：从“什么会出错”出发来设计解决方案。
  
- [冗余与备份](../redundancy/article.md) — FMEA识别出关键故障模式后，冗余设计是最常见的应对手段。
  
- FMEA经常揭示出系统中的[单点故障](../single-point-of-failure/article.md)，进而推动冗余设计。
  
- [安全边际](../../%E6%8A%95%E8%B5%84%E5%AD%A6%E4%B8%8E%E9%87%91%E8%9E%8D%E5%AD%A6/margin-of-safety/article.md)是投资领域对已知故障模式的预留缓冲。
  
- [概率思维与期望值](../../%E6%95%B0%E5%AD%A6%E4%B8%8E%E7%BB%9F%E8%AE%A1%E5%AD%A6/probabilistic-thinking-expected-value/article.md) — FMEA 中严重度、发生度和可探测度常用等级评分。等级的乘积是排序指标；只有实际概率乘可度量损失才是期望损失。
  
- [避免痛苦的心理否认](../../%E5%BF%83%E7%90%86%E5%AD%A6/simple-pain-avoiding-psychological-denial/article.md) — 正式故障清单也可能漏掉已出现但被低估的异常；审查时应把工程证据、异议和决定逐项对照。
  
- [检查清单](../../%E5%85%83%E8%AE%A4%E7%9F%A5%E4%B8%8E%E6%80%9D%E7%BB%B4%E6%96%B9%E6%B3%95%E8%AE%BA/checklist-method/article.md)是FMEA成果的日常化应用形式。
  
- FMEA试图在系统到达[断裂点](../breakpoints/article.md)之前识别并消除隐患。
  
- FMEA识别故障后，[权衡分析](../trade-off-analysis/article.md)帮助决定在可靠性、成本和性能之间如何取舍。
