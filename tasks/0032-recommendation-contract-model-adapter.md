# 0032：定稿推荐契约与模型接入

Status: done

实施记录：2026-09-25 在独立 `codex/concept-mvp-demo` 工作区实施；0031 已完成并提交 `6dc9284`。已实现请求/结果契约、紧凑候选卡、隔离适配器和 DeepSeek 真实适配器，见 [推荐契约](../specs/recommendation-contract.md) 与 [ADR 0003](../docs/adr/0003-deepseek-model-adapter.md)。

**What to build:** 按 [PRD §20–§25](../docs/method-system-prd-v0.1.md#20-搜索与推荐)定稿显式语言的输入、诊断/Why Now/空推荐输出、模型配置与本地优先边界，并建立可测试的模型适配层。

**Blocked by:** [0031：有限票据](0031-publish-finite-mvp-tickets.md)（已完成）。

## Acceptance criteria

- [x] `task`、`context`、`response`、可选 `user_intent`、`locale`、`limit` 的校验，以及 `diagnosis`、0–3 条推荐、`reason`、0–1 `confidence` 的输出契约有可运行 Schema/测试。
- [x] 本地模型配置、远端首次选择与无模型可用状态明确区分；未经选择不把 task/context/response 发往远端，不把模型缺失伪装成正常 NONE。
- [x] 模型提供方、配置位置、调用超时和错误形态记录为 ADR；自动化测试使用隔离假适配器，不调用外部模型。
- [x] `npm run check` 与适用构建通过，记录真实模型烟测是否可运行。

## 证据与未决事项

- `node --test tests/deepseek-model.test.mjs tests/recommendation-contract.test.mjs`：9/9 通过；覆盖结构契约、首次配置与同意、无模型/本地未接入/远端未选择、候选卡裁剪、上游身份错误、超时和正常 NONE。假 HTTP 响应不访问外网。
- `npm run model:smoke`：用户提供的临时 key 只在隐藏终端输入一次，合成中文任务与合成卡片经官方 API 返回 1 条诊断、1 条推荐；无私有内容或 key 落盘。此结果不证明推荐质量。
- `npm run check`：42/42 通过，含 Markdown/状态校验；`npm run demo:build` 和 `git diff --check` 通过。交互式配置另以隔离临时目录和假 key 验证：确需输入 `deepseek`，密钥输入不回显，生成 `.env` 权限为 `0600`；临时目录已删除。
- 未决：本机无本地模型，MVP 按用户选择用 DeepSeek 远端。0033 接线后继续用隔离测试验收 API；真实使用的 key 需用户自行首次配置。临时 key 测试后应注销。
