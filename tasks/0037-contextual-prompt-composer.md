# 0037：生成同语言上下文化 Prompt

Status: done

实施记录：2026-09-25 在独立 `codex/concept-mvp-demo` 工作区启动；前置 0036 已以 `45832be` 提交。Composer 作为 Skill 调用的服务端模块，不加入 Web 或对外 HTTP API；原始任务字段放入 JSON 数据块，防止输入伪装成 Composer 顶层指令。

**What to build:** 用户选择 Concept 后，将该语言的 Agent 指引、转化目标和避免条件与当前 task/context/response 组合成仅供 Skill 执行的 Prompt。

**Blocked by:** [0036：Relation 排序信号](0036-relation-ranking-signal.md).

## Acceptance criteria

- [x] Composer 读取最新 Concept 与显式 `locale`；缺少该语言资格、归档或不存在的 Concept 被拒绝，不借用另一语言内容。
- [x] 原始 task/context/response 保留原文；不同任务生成不同 Prompt；Registry 不保存固定完整 Prompt，Web 不生成或展示。
- [x] 测试覆盖 cn/en、同 Concept 不同上下文、恶意输入作为数据处理和失败边界；公共检查通过。

## 实施与证据

- [Composer 契约](../specs/prompt-composer.md)和 `server/prompt-composer.mjs` 实现 Skill 专用的 `composePrompt`，每次读取最新 Concept 版本和所选语言的 `agent_instruction`、`transform`、`avoid_when`。任务资料以 JSON 值原样保留，可解析恢复；输入中的换行及伪造标题不会成为顶层指令。完整 Prompt 不写入 Registry，未新增 HTTP 或 Web 入口。
- `node --test tests/prompt-composer.test.mjs`：3/3 通过（2026-09-25）。覆盖 cn/en 隔离、同 Concept 不同任务、编辑后读取最新版、原始空白和换行、恶意文本结构隔离，以及不存在/归档/错误语言/无资格/畸形输入。使用临时 SQLite 并清理。
- `npm run check`：57/57 通过；`npm run demo:build`、`git diff --check` 通过。此票不执行 Prompt 对真实任务的应用；该闭环属于 0038。JSON 数据边界不能保证后续语言模型必然抵抗提示注入。

## 未决与下一步

下一张依赖票据为 [0038 Concept Discovery Skill](0038-concept-discovery-skill.md)，负责用户触发、模型配置提示、选择与实际应用。
