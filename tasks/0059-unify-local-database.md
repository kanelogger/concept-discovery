# 0059：统一本地数据库与启动入口

Status: complete

## 目标与范围

按用户 2026-09-28 要求，项目本机只保留一份当前知识库数据和一个常规启动入口，删除旧库、重复库、历史快照及专用个人库启动脚本。

## 验收条件

- 项目默认库 `.local/concept-discovery.sqlite` 是唯一 SQLite 数据库文件，包含 6 条双语概念及 6 条创建修订。
- `.local/demo.sqlite`、`.local/personal-concepts.sqlite`、`.local/backups/` 和 `.local/start-personal.sh` 已移除。
- `npm start` 使用默认库；临时测试仍可通过 `CONCEPT_DB_PATH` 指定隔离库。

## 工作分工与进度

已从重复的 `.local/demo.sqlite` 将六条记录提升到产品契约规定的默认库，核对后删除重复库、旧数据快照和专用启动脚本。保留 `.local/concept-discovery-self-use/` 独立 Git 项目目录，它没有 SQLite 数据库且不是本项目的数据副本。

## 决策与未决事项

- 统一入口为仓库根目录的 `npm start`；服务与 `project.json` 已使用 `.local/concept-discovery.sqlite` 默认路径，无需再设置 `CONCEPT_DB_PATH`。
- 用户明确要求删除旧数据和冗余数据，因此删除全部本地数据库快照，不保留恢复副本。
- `CONCEPT_DB_PATH` 能力保留给自动化测试和明确隔离的临时演示库。

## 验证证据

| 日期 | 命令或审查 | 结果 / 退出码 | 证据及未覆盖范围 |
| --- | --- | --- | --- |
| 2026-09-28 | 本地 SQLite 文件盘点及只读核验 | passed | `.local/` 及其非嵌入仓库路径只剩 `.local/concept-discovery.sqlite`；6 个 Concept、6 个 Revision；所有旧库和备份已删除。服务端口未启动，本轮未做浏览器验证。 |
| 2026-09-28 | `npm run validate` | passed | 仓库入口、状态文件和 96 篇 Markdown 本地链接校验通过。 |
| 2026-09-28 | README 与操作文档审查 | passed | README 明确普通启动使用默认库；隔离演示说明改为不写默认知识库；0058 的旧恢复路径标注为已删除。 |

## 交接

后续使用 `npm start`，数据统一写入 `.local/concept-discovery.sqlite`。临时测试通过 `CONCEPT_DB_PATH` 指定新建隔离库。无其他本机数据副本。
