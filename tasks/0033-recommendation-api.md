# 0033：实现同语言 Recommendation API

Status: ready-for-agent

**What to build:** 从 P1 Registry 的指定语言可推荐池，结合真实模型诊断与排序输出最多三条带 Why Now 的 Concept；Web 仍不提供推荐输入或 Prompt。

**Blocked by:** [0032：推荐契约与模型接入](0032-recommendation-contract-model-adapter.md).

## Acceptance criteria

- [ ] 请求显式指定 `cn`/`en`，只读取该语言 active 且 recommendable 的 Concept；给模型的紧凑卡片不含图片字节与完整 Agent 指引。
- [ ] 输出默认 1 条、最多 3 条，可返回真实 NONE；诊断、理由、名称和卡片资料属于请求语言，禁止跨语言回退。
- [ ] `avoid_when`、重复/高度重叠、低增益与互补性影响选择；无模型、模型错误和合法空推荐是不同结果。
- [ ] 隔离 Registry 与假模型覆盖双语、0/1/3 条、排除与无模型边界；真实模型可用时做烟测；公共检查通过。
