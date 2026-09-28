# 0058：重置个人库并填入六条精选概念

Status: complete

## 目标与范围

按用户 2026-09-28 明确要求，清空默认个人 SQLite 库中的既有数据，并从 `docs/knowledge-list.json` 与 `docs/private-project/models-data/*` 选取整理 6 条概念写入。源文件保持不变；操作前创建可恢复数据库快照。

## 验收条件

- `.local/personal-concepts.sqlite` 只含 6 条新概念及其创建修订，无旧概念、关系或 Usage 数据。
- 六条记录中英文均可浏览，知识清单与 Untools 本地模型资料各贡献 3 条。
- 原始来源文件未修改，旧库完整快照留在 `.local/backups/`。

## 工作分工与进度

已完成个人库替换。知识清单选取 `falsifiability`、`first-principles`、`redundancy-backup`；本地模型资料整理 `hard-choice-model`、`minto-pyramid`、`ooda-loop`。

## 决策与未决事项

- 目标库由 `.local/start-personal.sh` 明确指向 `.local/personal-concepts.sqlite`；默认 `.local/concept-discovery.sqlite` 是空库，未修改。
- 用户授权清空个人库。操作前使用 SQLite `VACUUM INTO` 保存完整快照：`.local/backups/personal-concepts-before-six-2026-09-28.sqlite`。
- 三条私有模型资料概念由本地英文原文整理为双语内容；原始 Markdown 与知识清单均未改写。

## 验证证据

| 日期 | 命令或审查 | 结果 / 退出码 | 证据及未覆盖范围 |
| --- | --- | --- | --- |
| 2026-09-28 | 替换脚本预检及 SQLite 只读核对 | passed | 新库 6 个 Concept、6 个 Revision；中文/英文可浏览各 6 条；关系、Usage、媒体记录为 0。旧快照核对为 12 个 Concept、12 个 Revision。未运行自动化测试。 |

## 交接

个人库当前包含 `falsifiability`、`first-principles`、`hard-choice-model`、`minto-pyramid`、`ooda-loop`、`redundancy-backup`。需要恢复旧数据时，可将 `.local/backups/personal-concepts-before-six-2026-09-28.sqlite` 作为恢复来源。无后续操作。
