# 0008：关联 triage 技能并配置标签映射

## 目标与范围

将 Matt Pocock 的 `triage` 技能用于当前项目，并创建默认状态标签映射。用户已授权本地 Skill Port 项目关联和仓库 Markdown 配置。

检查发现 `triage` 已由 Skill Port 关联到本项目，启用入口健康，因此不重复创建或覆盖链接。本次补全 `docs/agents/triage-labels.md` 并更新 `AGENTS.md` 与 issue tracker 约定。

## 验收条件

- Skill Port 报告 `triage` 在当前项目下已启用且健康。
- `AGENTS.md` 链接 triage 标签映射。
- 映射文件列出五个默认状态名，并说明本地任务文件中的 `Status:` 字段。
- `workflow-state.json.phase` 的执行阶段语义保持独立。
- `npm run validate` 通过。

## 工作分工与进度

- 负责人：主 Agent。
- 文件范围：`AGENTS.md`、`docs/agents/issue-tracker.md`、`docs/agents/triage-labels.md`、本任务记录、`workflow-state.json`。
- 进度：配置和验证已完成。

## 决策与未决事项

- Skill Port 核验时发现项目已有指向受管 `triage` Skill 的健康 symlink enablement；复用现有关联，避免重复写入。
- 用户指定采用默认标签：`needs-triage`、`needs-info`、`ready-for-agent`、`ready-for-human`、`wontfix`。
- 本地任务记录使用 `Status:` 表示 triage 状态；全局活动任务的 `workflow-state.json.phase` 继续表示工作流执行阶段。
- 未决：无。

## 验证证据

| 日期 | 命令或审查 | 结果 / 退出码 | 证据及未覆盖范围 |
| --- | --- | --- | --- |
| 2026-09-23 | `sklp info triage --json`、`sklp doctor --json` | passed | 当前项目 enablement health 为 `healthy`；doctor 无 diagnostics |
| 2026-09-23 | `npm run validate` | passed（退出码 0） | 项目清单、任务状态、必需路径和 29 个 Markdown 文件的本地链接通过 |

## 交接

结果：triage 技能已在当前项目健康启用；默认状态标签映射和文档入口已创建。`npm run validate` 通过。

下一步：无。
