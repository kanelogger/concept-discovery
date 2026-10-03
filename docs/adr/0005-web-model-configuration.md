# ADR 0005：网页模型设置与 pi provider

日期：2026-10-03。状态：accepted。

## 决定

- 用 Web 模型设置取代终端配置。支持 DeepSeek API Key，以及 `@earendil-works/pi-ai@1.0.0` 提供的 OpenAI/ChatGPT、Anthropic/Claude、GitHub Copilot OAuth。订阅流程在 Node 服务端运行，网页只呈现授权链接、设备码和 provider 提示步骤。
- 多个凭据可共存；推荐只使用用户在页面显式选定的 provider/model。授权新账号不自动改变当前模型。连接测试使用合成请求；常规推荐仍按现有 `/api/discover` 和 `/api/recommendations` 输入及候选边界运行，并验证统一输出契约。
- pi `CredentialStore` 存于独立 `.local/model-auth/model-auth.sqlite`，避免与知识库备份或浏览器数据共用。使用受限目录与文件权限、SQLite 事务序列化写入及 OAuth 刷新；服务端禁用 provider 的环境变量回退。设置 API 校验 loopback Host；写接口要求同源 Origin，推荐接口拒绝跨源浏览器请求，同时保留无 Origin 的本地 Agent CLI 调用。不返回、记录或写入浏览器存储任何凭据。
- 服务启动时只迁移明确选择 DeepSeek 且具有 `.env` Key 的旧配置。先在权限为 `0700` 的本地私有目录创建 `0600` 备份，再将 Key 与 active model 原子提交到凭据 SQLite，随后移除旧模型字段；保留 `.env` 其他配置。迁移以数据库标记幂等完成，失败时保留原配置。
- 本决定替代 ADR 0003 中“终端配置 DeepSeek、Web 不承担模型配置”的部分。0032–0036 的推荐输出契约、候选语言边界、用户选择以及超时错误语义继续适用。

## 依据与验证

pi-ai README 说明 provider 自有 OAuth、`CredentialStore` 的 `read/list/modify/delete` 合约以及 OAuth 刷新在 `modify` 锁内执行；OAuth 仅 Node 可用，网页需经本地后端接入。该依赖以 1.0.0 固定。自动验证覆盖迁移、授权事件桥接、API 来源校验、模型选择和无秘密响应；真实账号授权与远端调用需用户在页面完成。

来源：[pi-ai README](https://github.com/earendil-works/pi/blob/main/packages/ai/README.md)、[pi-ai 1.0.0 package](https://www.npmjs.com/package/%40earendil-works/pi-ai)。
