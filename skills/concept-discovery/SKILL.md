---
name: concept-discovery
description: 用户明确调用 concept-discovery，或直接要求为当前任务寻找并应用适用的 Concept 时，使用本地 Registry 推荐、让用户选择，再将 Concept 用于任务。
---

# Concept Discovery

只在用户发出 `/concept-discovery` 等明确命令，或直接请求寻找适用 Concept 时启动。普通任务中不主动推荐。推荐、查看与应用是不同动作；用户没有选中 Concept 时不要 Compose 或宣称已应用。

在本仓库运行。先确认 `npm start` 的本地服务已启动，并使用与服务相同的 `CONCEPT_DB_PATH`。调用时明确给出 `locale: "cn"` 或 `"en"`；按用户当前任务语言选定，不明确时向用户确认。传给推荐接口的 `task`、`context`、`response` 只取完成当前请求必要的内容，不加入密钥或无关私有资料。

将 JSON 输入经标准输入传给 `node scripts/skill-discovery.mjs recommend`，格式为 `{ "invocation": "command" | "direct_request", "request": { "task": "...", "context": "...", "response": "...", "locale": "cn", "limit": 1 } }`。本命令调用正式 `POST /api/recommendations`，默认只连接 `http://127.0.0.1:4173`。不要把原始任务文本放进命令行参数或持久化文件。

- 返回 `recommendations: []` 是正常 NONE：说明当前没有值得增加的 Concept，继续原任务。
- 返回模型未配置、同意缺失或本地模型不可用的错误时，解释当前无法推荐。首次使用远端 DeepSeek 前让用户在终端运行 `npm run model:configure`，阅读外发说明并自行选择；未经选择不发送任务到远端。不要在聊天或仓库中保存密钥。
- 有结果时展示最多三项的当前语言名称与 Why Now 理由，并让用户选择 Apply、查看详情或忽略。查看详情可用本地 `GET /api/concepts/:id`；不要把查看当作应用。用户拒绝后正常继续任务。

收到用户明确选择后，将原请求、已展示的 `recommended_ids` 和 `selected_id` 经标准输入传给 `node scripts/skill-discovery.mjs compose`。此命令从同一 Registry 读取最新版并返回所选语言 Prompt；若 Concept 已归档或失去资格，说明无法应用并重新推荐。Agent 应将返回的 Prompt 实际用于当前任务，在最终答复中给出经 Concept 处理的成果；只展示 Prompt 或卡片不算 Apply。不要把 Composer 加进 Web。

两阶段调用的 JSON 可由 Agent 在内存中构造并通过带引号的 heredoc 提供给命令。该 Skill 的项目源码在 `skills/concept-discovery/`；在 Codex 中安装时，将此目录链接到个人 skills 目录。此项目提交不修改用户全局 skills 配置。Usage 事件由后续 0039 接入；在此之前不要伪造应用次数。
