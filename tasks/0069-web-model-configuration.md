# 0069：网页模型配置与订阅登录

Status: complete

## 目标与范围

将旧终端 `.env` DeepSeek 配置迁至 Web 设置页，并用 `@earendil-works/pi-ai` 提供 DeepSeek API Key、OpenAI/ChatGPT、Anthropic/Claude 和 GitHub Copilot 模型接入。网页完成 OAuth 交互、模型选择、连通测试和断开；本地服务独占凭据与模型调用。现有搜索推荐和 Skill 推荐均使用当前显式选定的模型。

## 验收条件

- 设置页能展示脱敏配置状态，支持 DeepSeek API Key 配置、三种订阅 OAuth、模型选择、连通测试与断开；授权取消、交互步骤、失效凭据和提供方失败有可理解结果。
- pi CredentialStore 持久化 OAuth/API 凭据及自动刷新，秘密仅在本地独立存储，权限受限且具备原子写入/序列化修改；API 不返回秘密并限制本地来源。
- `/api/discover` 与 `/api/recommendations` 使用当前 provider/model 的 pi adapter；继续执行既有输出校验、语言资格、超时与脱敏错误语义。
- 首次服务启动幂等迁移 `.env` 中 DeepSeek 配置，先安全备份，成功持久化后移除旧模型字段，保留其他环境项。旧终端配置入口不再存在。
- 更新当前契约、ADR 替代说明、Skill、命令文档和锁文件；保留历史任务事实及无关工作区更改。
- 相关自动化测试、`npm run check` 与 `npm run demo:build` 通过；浏览器人工授权依赖用户账号，使用模拟 OAuth/模型覆盖自动化测试。

## 工作分工与进度

- 主 Agent：全任务实现；未委派。
- 环境与代码现状已检查：单机 Node/Vite 服务，模型配置位于 `server/model-config.mjs`，Web 导航位于 `src/product/App.tsx`，本机 `.env` 仅包含旧模型配置字段。
- 已接入固定版本 pi-ai、服务端持久凭据与 OAuth 事件接口、双语设置页；DeepSeek、OpenAI/ChatGPT、Anthropic/Claude、GitHub Copilot provider 均已注册。
- 已删除旧 `.env.example` 模型变量、终端配置/烟测入口、DeepSeek 专用配置和适配器；README、Skill、命令说明、推荐契约和 ADR 已更新。
- 本机 `.env` 的 DeepSeek 凭据已迁移；备份为 `.local/model-auth/legacy-env-2026-10-03T03-19-05.774Z-7519ad63-4cd4-48d0-806d-4f73bf9b6f2a.bak`。旧 `.env` 仅含模型配置字段，迁移后已移除。

## 决策与未决事项

- 同时接入 OpenAI（ChatGPT subscription）、Anthropic（Claude Pro/Max）与 GitHub Copilot OAuth；保留 DeepSeek API Key 配置。
- 多个凭据可并存，但启用模型必须由用户显式选择；DeepSeek 迁移后保持现有启用状态。
- 凭据使用独立 `.local/model-auth.sqlite`，配置与迁移状态存于同一受限本机数据域；采用 `node:sqlite` `BEGIN IMMEDIATE` 序列化 pi CredentialStore 的修改，凭据文件权限 `0600`。
- 网页 API 校验 Host/Origin；令牌不进浏览器状态、日志或返回体。OAuth 由服务端启动，UI 通过短轮询和受限交互接口呈现授权流程。
- 自动化验证不进行真实账号登录或外网模型调用；用户在本地设置页完成真实订阅授权和连通测试。

## 验证证据

| 日期 | 命令或审查 | 结果 / 退出码 | 证据及未覆盖范围 |
| --- | --- | --- | --- |
| 2026-10-03 | `npm run check` | passed / 0 | 仓库校验与 91 项测试全通过；覆盖凭据迁移/幂等、DeepSeek 配置、模型目录与选择、授权提示桥接、密钥不泄露及跨源拦截。首次沙箱运行被回环监听 `EPERM` 阻止，获准在本机回环环境重跑后通过。 |
| 2026-10-03 | `npm run demo:build` | passed / 0 | TypeScript 检查及 Vite 生产构建通过。 |
| 2026-10-03 | Web 设置页与 `GET /api/model-settings` | passed / 0 | 页面显示迁移后的 DeepSeek 当前模型；API 返回 200，仅含 active model 与连接状态，无 Key/Token 字段。真实账号 OAuth 和付费模型请求未执行；OAuth 交互由模拟 provider 验证。 |
| 2026-10-03 | 本机凭据迁移审计与启动 | passed / 0 | `.local/model-auth` 权限 `0700`，SQLite 与备份权限 `0600`；备份已保留，旧 `.env` 不存在。迁移后重启日志无错误。 |
| 2026-10-03 | `git diff --check` | passed / 0 | 无空白错误；未跟踪的 `docs/knowledge-list.deferred.json` 与本任务无关，保留未改。 |

## 交接

实现和验证完成。真实 OpenAI/Claude/Copilot 账号登录及模型连通性仍由账号持有人在本地“模型设置”页完成；测试没有发起真实 OAuth 或付费推理调用。服务已停止。
