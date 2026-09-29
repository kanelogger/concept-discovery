# 0065：补充剩余思维模型文章

Status: complete

## 目标与范围

将 `docs/private-project/models-data/` 中尚未进入默认个人库的思维模型补入 `.local/concept-discovery.sqlite`。沿用 `scripts/import-local-articles.mjs`：为缺少对应 Concept 的资料新建英文条目，并导入标题、简介、英文原文、来源 URL 和图片。已存在的四篇文章保持不变；不翻译或补写中文内容，也不更改原始资料。

本次输入盘点：25 个模型目录，已有条目 `first-principles`、`hard-choice-model`、`minto-pyramid`、`ooda-loop`；计划新增其余 21 个模型。

## 验收条件

- 21 个缺少条目的模型均在默认个人库中创建，四个既有文章条目及其他原有记录保留。
- 新条目包含英文名称、简介、来源 URL、文章正文；正文中的本地 PNG 引用替换为已导入的 Registry 图片地址。
- 写入前创建数据库备份；复核新增条目数、正文、来源和图片引用。
- `npm run validate` 通过；差异审查只包含本任务记录与工作流状态。个人数据库位于 `.local/`，不进入 Git。

## 工作分工与进度

当前 Agent 独立负责。开始时工作树干净，当前分支 `codex/article-detail-page`。只读核实默认库包含 6 条记录；资料目录有 25 篇英文文章，已有的 4 篇与资料目录重合。导入器 dry-run 对 21 篇全部给出 `create`，各文章去重后共 57 个 PNG。

## 决策与未决事项

- 用户明确要求在已有数据上补齐剩余思维模型；按已有 4 篇英文文章各建一张英文卡片的既有范围，导入剩余 21 篇。
- 输入原文只有英文；仅创建英文条目，中文内容保持待维护状态。
- 应用导入器会在写入前保存 SQLite 快照至 `.local/backups/`。脚本和源资料不修改。

## 验证证据

| 日期 | 命令或审查 | 结果 / 退出码 | 证据及未覆盖范围 |
| --- | --- | --- | --- |
| 2026-09-29 | `node scripts/import-local-articles.mjs ... --create-missing`（dry-run） | passed / 0 | 21 项均为 `create`；合计 57 张 PNG；尚未写数据库。 |
| 2026-09-29 | `node scripts/import-local-articles.mjs ... --create-missing --apply` | passed / 0 | 新建 21 条；备份为 `.local/backups/articles-before-import-2026-09-29T03-14-41-502Z.sqlite`。 |
| 2026-09-29 | SQLite 内容及完整性审计 | failed / 1，后修正 | 初次断言误把 57 个逐文章去重图片数当成正文引用次数；核实正文实际有重复引用。 |
| 2026-09-29 | SQLite 内容及完整性审计（按正文引用数 59） | passed / 0 | 总计 27 条；21 条新增记录均有英文名称、来源 URL、正文；59 次图片引用的资源哈希均存在；6 条旧记录版本未变；SQLite `integrity_check=ok`。新增条目未生成中文正文，符合范围。 |
| 2026-09-29 | `npm run validate` | passed / 0 | 项目清单、工作流状态、必需路径及 102 个 Markdown 的本地链接通过。 |

## 交接

导入与数据审计已完成。新增 21 张英文模型卡片并保留 6 条原记录；SQLite 备份保存在 `.local/backups/`。默认个人库为忽略文件，不进入 Git。中文正文仍待维护者独立编写。
