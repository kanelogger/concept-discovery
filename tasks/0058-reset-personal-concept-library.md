# 0058：重置个人库并填入六条精选概念

Status: complete

## 目标与范围

按用户 2026-09-28 明确要求，清空默认个人 SQLite 库中的既有数据，并从 `docs/knowledge-list.json` 与 `docs/private-project/models-data/*` 选取整理 6 条概念写入。源文件保持不变；操作前创建可恢复数据库快照。

## 验收条件

- `.local/personal-concepts.sqlite` 与用户实际指定的 `.local/demo.sqlite` 均只含 6 条新概念及其创建修订，无旧概念、关系或 Usage 数据。
- 六条记录中英文均可浏览，知识清单与 Untools 本地模型资料各贡献 3 条。
- 原始来源文件未修改，旧库完整快照留在 `.local/backups/`。

## 工作分工与进度

已完成个人库和演示库替换。知识清单选取 `falsifiability`、`first-principles`、`redundancy-backup`；本地模型资料整理 `hard-choice-model`、`minto-pyramid`、`ooda-loop`。用户后续澄清实际使用 `.local/demo.sqlite`，因此也将该库中的 12 条旧演示样本替换为同一组 6 条。

## 决策与未决事项

- `.local/start-personal.sh` 指向 `.local/personal-concepts.sqlite`；用户后续明确指定演示启动命令使用 `.local/demo.sqlite`。默认 `.local/concept-discovery.sqlite` 是空库，未修改。
- 操作前分别使用 SQLite `VACUUM INTO` 保存完整快照：`.local/backups/personal-concepts-before-six-2026-09-28.sqlite` 和 `.local/backups/demo-before-six-2026-09-28.sqlite`。
- 三条私有模型资料概念由本地英文原文整理为双语内容；原始 Markdown 与知识清单均未改写。

## 验证证据

| 日期 | 命令或审查 | 结果 / 退出码 | 证据及未覆盖范围 |
| --- | --- | --- | --- |
| 2026-09-28 | 替换脚本预检及 SQLite 只读核对 | passed | 新库 6 个 Concept、6 个 Revision；中文/英文可浏览各 6 条；关系、Usage、媒体记录为 0。旧快照核对为 12 个 Concept、12 个 Revision。未运行自动化测试。 |
| 2026-09-28 | 启动指定数据库的本机服务（`PORT=4193`） | blocked | 沙箱拒绝 Vite WebSocket 端口 `24678` 和回环端口 `4193`（EPERM）；数据库只读核对确认 `.local/demo.sqlite` 已含同一组 6 条双语记录。 |

## 交接

个人库和演示库当前都包含 `falsifiability`、`first-principles`、`hard-choice-model`、`minto-pyramid`、`ooda-loop`、`redundancy-backup`。运行 `CONCEPT_DB_PATH="$PWD/.local/demo.sqlite" npm start` 前确认该端口没有另一服务占用；服务启动后刷新页面。需要恢复原数据时，分别使用 `.local/backups/personal-concepts-before-six-2026-09-28.sqlite` 或 `.local/backups/demo-before-six-2026-09-28.sqlite`。
