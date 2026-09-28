# 0060：移除会切换到独立样本库的 README 命令

Status: complete

## 目标与范围

用户按 README 的 Isolated sample library 命令启动后仍看到旧演示数据。排查确认该命令会建立另一份含 12 条旧样本的 `/tmp/concept-demo-new.sqlite`，并让服务连接它。本任务删除误生成的临时库，明确 README 与命令文档中的默认库/隔离库边界。

## 验收条件

- README 日常启动说明只指向 `.local/concept-discovery.sqlite`，明确不要为常规使用设置 `CONCEPT_DB_PATH`。
- 文档解释 `demo:prepare` 创建独立的 12 条样本库，只用于隔离验收。
- `/tmp/concept-demo-new.sqlite` 与 SQLite 伴随文件已删除；默认库仍有 6 条精选数据。

## 工作分工与进度

已完成。读取脚本和实际临时库证实它创建了 12 个旧演示样本；移除了该临时库及伴随文件，并更新 README 和 Agent 命令说明。

## 决策与未决事项

保留 `demo:prepare` 作为隔离验收工具；README 不再给出会创建并切换到另一数据库的具体启动命令。

## 验证证据

| 日期 | 命令或审查 | 结果 / 退出码 | 证据及未覆盖范围 |
| --- | --- | --- | --- |
| 2026-09-28 | SQLite 只读检查及文件清理 | passed | 临时库原有 12 条旧样本；库文件与伴随文件已删除。默认库仍含 6 条精选概念。 |
| 2026-09-28 | `npm run validate` | passed | 文档与 workflow-state 校验通过。 |

## 交接

常规使用从仓库根目录运行 `npm start`，不设置 `CONCEPT_DB_PATH`。只有隔离验收才准备额外库，完成后删除临时库。
