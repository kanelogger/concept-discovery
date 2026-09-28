# 0056：配置命令写入明确模型 ID

Status: complete

## 目标与范围

修复 `npm run model:configure` 只记录 DeepSeek provider、远端同意和密钥，却没有把实际模型 ID 写入 `.env` 的缺口。配置命令应明确选择并保存具体模型 ID，服务端请求与响应元数据使用该配置。当前适配器只连接 DeepSeek Chat Completions；本任务不新增 OpenAI/GPT provider。

## 验收条件

- 交互配置展示并确认具体 DeepSeek 模型 ID，保存为 `.env` 中的模型变量。
- 服务端从配置读取模型 ID，传给 API 请求且反映在 adapter metadata；无配置时兼容既有 `deepseek-flash` 默认值。
- 测试覆盖保存、读取及实际请求模型 ID。
- 契约、命令说明与任务/状态记录一致。

## 工作分工与进度

已完成配置脚本、DeepSeek 适配器、配置测试、契约与命令文档更新。

## 决策与未决事项

`gpt-6-luna` 属于不同提供方，不可通过当前 DeepSeek endpoint 使用；仅增加 DeepSeek 模型 ID 配置，不暗示新增 OpenAI 支持。默认选择 `deepseek-flash`，允许用户在交互命令中输入 DeepSeek endpoint 支持的模型 ID。

## 验证证据

| 日期 | 命令或审查 | 结果 / 退出码 | 证据及未覆盖范围 |
| --- | --- | --- | --- |
| 2026-09-28 | `node --test tests/deepseek-model.test.mjs` | passed / 0 | 3/3 测试通过；验证模型 ID 保存、读取、metadata 和请求体。 |
| 2026-09-28 | `npm run check` | passed / 0 | 校验器通过；完整测试 84/84 通过。首次沙箱内运行因回环端口 EPERM 未通过，获批在沙箱外重跑后通过。 |

## 交接

`DEEPSEEK_MODEL` 已由配置命令写入 `.env` 并被 DeepSeek 适配器使用；无配置时默认 `deepseek-flash`。当前不支持 GPT provider。
