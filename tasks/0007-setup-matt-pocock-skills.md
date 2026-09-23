# 0007：配置 Matt Pocock 工程技能约定

## 目标与范围

按 Matt Pocock `setup-matt-pocock-skills` 的仓库配置流程，为本项目记录任务追踪与领域文档入口。用户已指定任务由本地 Markdown 管理、普通单项目、沿用现有文档约定；如需 triage 标签，使用默认名称。本项目未安装 triage 技能，因此本次不生成 triage 标签映射。

范围仅包括 `docs/agents/` 中的仓库级配置说明，以及 `AGENTS.md` 中的技能入口索引。沿用 `tasks/`、`workflow-state.json`、`specs/` 和 `docs/adr/`，不新建平行 `.scratch/` 工作流，不安装其他技能。

## 验收条件

- `AGENTS.md` 有唯一的 `## Agent skills` 入口，链接 issue tracker 与 domain docs 配置。
- `docs/agents/issue-tracker.md` 准确说明本地 Markdown 任务工作流及现有任务目录约定。
- `docs/agents/domain.md` 指向现有项目契约、工作流和 ADR，不虚构根级 `CONTEXT.md`。
- 未安装 triage 时不生成 `triage-labels.md` 或相应入口；记录用户要求启用时采用默认标签名。
- `npm run validate` 通过。

## 工作分工与进度

- 负责人：主 Agent。
- 文件范围：`AGENTS.md`、`docs/agents/issue-tracker.md`、`docs/agents/domain.md`、本任务记录、`workflow-state.json`。
- 进度：配置和审查已完成。

## 决策与未决事项

- 任务追踪使用既有 `tasks/` 结构，而非上游模板默认的 `.scratch/`；理由是用户要求沿用项目文档约定，且 `workflow/README.md` 已规定任务建档、状态和交接。
- 领域文档按单项目约定记录；沿用 `specs/product-contract.md` 和 `docs/adr/`。根级 `CONTEXT.md` 留待领域建模出现尚未覆盖的稳定术语时再创建。
- `triage` 技能当前未安装，因此按上游 setup 流程跳过 triage 标签映射。用户指定如未来需要标签时采用默认名称：`needs-triage`、`needs-info`、`ready-for-agent`、`ready-for-human`、`wontfix`。
- 未决：无。

## 验证证据

| 日期 | 命令或审查 | 结果 / 退出码 | 证据及未覆盖范围 |
| --- | --- | --- | --- |
| 2026-09-23 | `npm run validate` | passed（退出码 0） | project manifest、workflow state、required paths 与 27 个 Markdown 文件中的本地链接均通过；不验证外部工程技能行为 |

## 交接

结果：本地任务追踪与领域文档约定已记录在 `docs/agents/`，`AGENTS.md` 已加入入口。未创建 triage 映射，因为当前没有 triage 技能。`npm run validate` 通过。

下一步：无。
