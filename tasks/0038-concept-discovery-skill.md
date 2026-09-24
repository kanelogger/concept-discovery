# 0038：接入主动调用的 Concept Discovery Skill

Status: ready-for-agent

**What to build:** 提供仅在明确命令或直接自然语言请求下运行的 Skill，调用正式推荐接口，向用户展示 0–3 条并在用户选择后执行 Composer 生成的同语言 Prompt。

**Blocked by:** [0037：上下文化 Prompt Composer](0037-contextual-prompt-composer.md).

## Acceptance criteria

- [ ] 普通任务不自动推荐；主动调用显式传 `locale`，无模型时提示配置/选择，未经选择不发送上下文到远端。
- [ ] 用户查看、忽略或选择推荐的路径清晰；只有用户选择后才生成 Prompt，Agent 将其用于当前任务，单纯展示不算 Apply。
- [ ] Skill 从与 Web 相同的 Registry 读取最新 Concept；双语、NONE、禁用/归档、无模型与用户拒绝分支有端到端验收。
- [ ] 记录安装/调用方式，运行公共检查与可用模型烟测；不在 Web 加 Playground。
