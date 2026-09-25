# 0038：接入主动调用的 Concept Discovery Skill

Status: done

实施记录：2026-09-25 在独立 `codex/concept-mvp-demo` 工作区启动；前置 0037 已以 `56aa3e7` 提交。项目级 Skill 放在受版本控制的 `skills/concept-discovery/`，由 Agent 在用户明确触发时使用；辅助 CLI 用 stdin JSON 避免把任务原文或密钥写进命令行参数。

**What to build:** 提供仅在明确命令或直接自然语言请求下运行的 Skill，调用正式推荐接口，向用户展示 0–3 条并在用户选择后执行 Composer 生成的同语言 Prompt。

**Blocked by:** [0037：上下文化 Prompt Composer](0037-contextual-prompt-composer.md).

## Acceptance criteria

- [x] 普通任务不自动推荐；主动调用显式传 `locale`，无模型时提示配置/选择，未经选择不发送上下文到远端。
- [x] 用户查看、忽略或选择推荐的路径清晰；只有用户选择后才生成 Prompt，Agent 将其用于当前任务，单纯展示不算 Apply。
- [x] Skill 从与 Web 相同的 Registry 读取最新 Concept；双语、NONE、禁用/归档、无模型与用户拒绝分支有端到端验收。
- [x] 记录安装/调用方式，运行公共检查与可用模型烟测；不在 Web 加 Playground。

## 实施与证据

- [项目 Skill](../skills/concept-discovery/SKILL.md)规定命令或直接请求触发、显式语言、0–3 项展示、查看/忽略/选择和 Agent 实际应用边界；[README](../README.md#concept-discovery-skill)记录本地安装与调用方式。受控的 `recommend`/`compose` CLI 使用 stdin JSON：前者经正式本地 API，后者在显式选择后读取与 Web 同一 SQLite Registry 的最新 Concept，并交给 Agent 执行 Prompt。未新增 Web Playground，未保存任务原文、密钥或生成 Prompt。
- `node --test tests/skill-flow.test.mjs`：2/2 通过（2026-09-25）。隔离本地服务与假模型覆盖主动调用门槛、中文/英文、CLI 两阶段、NONE、`avoid_when` 模拟、模型同意缺失、用户不选择、非本地 API 拒绝，以及推荐后归档导致 Compose 拒绝。测试使用临时 SQLite 并清理；真实 Agent 的实际应用由 Skill 指令与用户选择流程承担，不以“只输出 Prompt”冒充成功应用。
- `python3 .../skill-creator/scripts/quick_validate.py skills/concept-discovery`：Skill 格式通过。`npm run doctor`：Node 24、Git、工作区通过；`npm run check`：59/59 通过；`npm run demo:build` 通过。0033 已用临时 DeepSeek key 对同一正式 API 做六条中英合成真实模型烟测；本票未重传密钥或再发起远端请求，新增 Skill CLI 的端到端验收使用假模型。真实模型对选择/应用语义的人工验收留给 0040。

## 未决与下一步

Usage 事件和 Dashboard 使用统计属于 [0039](0039-skill-feedback-usage.md)。Skill 目前按项目目录交付，未修改用户全局 skills 安装目录；验收时可按 README 链接安装。
