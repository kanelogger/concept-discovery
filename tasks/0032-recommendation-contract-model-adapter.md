# 0032：定稿推荐契约与模型接入

Status: ready-for-agent

**What to build:** 按 [PRD §20–§25](../docs/method-system-prd-v0.1.md#20-搜索与推荐)定稿显式语言的输入、诊断/Why Now/空推荐输出、模型配置与本地优先边界，并建立可测试的模型适配层。

**Blocked by:** [0031：有限票据](0031-publish-finite-mvp-tickets.md)；真实模型提供方、模型名称与端点需用户选择。

## Acceptance criteria

- [ ] `task`、`context`、`response`、可选 `user_intent`、`locale`、`limit` 的校验，以及 `diagnosis`、0–3 条推荐、`reason`、0–1 `confidence` 的输出契约有可运行 Schema/测试。
- [ ] 本地模型配置、远端首次选择与无模型可用状态明确区分；未经选择不把 task/context/response 发往远端，不把模型缺失伪装成正常 NONE。
- [ ] 模型提供方、配置位置、调用超时和错误形态记录为 ADR；测试使用隔离假适配器，不调用外部模型。
- [ ] `npm run check` 与适用构建通过，记录真实模型烟测是否可运行。
