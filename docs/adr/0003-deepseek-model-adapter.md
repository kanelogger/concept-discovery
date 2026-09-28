# ADR 0003：推荐模型首选配置与 DeepSeek 接入

日期：2026-09-25。状态：accepted for MVP implementation。

## 决定

- 用户首次启用远端推荐时，在交互终端运行 `npm run model:configure`，阅读数据外发说明并输入 `deepseek` 才选择远端 DeepSeek，再确认模型 ID（默认 `deepseek-flash`）。随后隐藏输入 API key；程序将选择、模型 ID、同意状态与 key 写入被 Git 忽略的 `.env`，权限为 `0600`。未完成这一步不会发送 task、context 或 response。Skill 在首次调用时提示该配置命令；Web 不承担模型配置或推荐入口。
- 本次选定模型 `deepseek-flash`，使用官方 Chat Completions `POST https://api.deepseek.com/chat/completions`，通过 `Authorization: Bearer` 鉴权。服务端使用 Node 内置 `fetch`，不增加 SDK 依赖。请求用非流式 JSON Output，并在系统指令中明确要求 JSON 结构；完整任务文本与同语言紧凑 Concept 卡片作为 user 消息。结果仍由服务端验证资格、语言、ID、条数、理由与置信度。
- 默认模型调用超时为 30 秒；调用者可在服务端覆盖，超时取消请求并返回 `504 model_timeout`。未配置返回 `503 model_unavailable`，未明确选择远端返回 `503 model_consent_required`，本地模型被选但无适配器返回 `503 local_model_unavailable`，密钥被拒返回 `503 model_credentials_invalid`，提供方错误或格式错误返回 `502`。不将上游错误正文、密钥或原始用户上下文写入日志或公开错误。
- 本机当前无已配置的本地模型。用户选择 DeepSeek 作为 MVP 远端模型；未来如接入本地提供方，须单独实现适配器，不能把未实现的 `local` 配置静默路由到 DeepSeek。

## 依据与验证

DeepSeek [首次调用](https://api-docs.deepseek.com/zh-cn/)文档确认 `deepseek-flash`、Base URL 和鉴权；[Chat Completions](https://api-docs.deepseek.com/zh-cn/api/create-chat-completion/)及 [JSON Output](https://api-docs.deepseek.com/zh-cn/guides/json_mode/)文档确认 `response_format: {"type":"json_object"}` 以及提示中必须要求 JSON。用户在本次会话选择远端 DeepSeek，并要求首次由用户配置。

隔离假适配器及假 HTTP 响应测试不访问外网。2026-09-25 使用用户提供的临时密钥，经隐藏终端输入运行 `npm run model:smoke`；仅发送合成中文任务与一张合成卡片，`deepseek-flash` 成功返回 1 条诊断和 1 条推荐。密钥未写入仓库文件或测试输出，烟测进程退出后不保留。此烟测证明接口可调用，不证明推荐质量；推荐质量由 0033 和 0034 验收。

来源：[产品契约](../../specs/product-contract.md)、[推荐契约](../../specs/recommendation-contract.md)、PRD §24（历史文件 `docs/method-system-prd-v0.1.md`，见下方来源说明）。

> 历史来源说明：旧产品材料已在 0045 合并删除；原文恢复方式见[文档收敛决策](0004-product-doc-consolidation.md)。本文保留当时的任务或接口记录，不作为当前产品路线图。
