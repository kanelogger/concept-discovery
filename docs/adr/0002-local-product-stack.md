# ADR 0002：本地产品栈与 Registry 存储

日期：2026-09-25。状态：accepted for MVP implementation。

## 决定

- Web 沿用 demo 已安装的 React、TypeScript、Vite 视觉基础，但正式页面从新的产品入口实现，不读取原型 seed 或内存状态。
- 本地服务使用 Node 24 内置 HTTP 与 `node:sqlite`。概念、修订及后续关系、使用事件存入同一 SQLite 数据库；服务端是唯一写入者。
- 默认数据库路径为 `.local/concept-discovery.sqlite`，可用 `CONCEPT_DB_PATH` 指向隔离的测试或演示文件。数据库文件不纳入 Git。
- 写入使用 SQLite 事务、唯一主键和版本检查。0025 起 WebP 原始字节按 SHA-256 内容哈希存于同一 SQLite 的 `media_assets` 表，Concept 保存哈希引用；文字、Wiki 与图片变动在同一事务写入 Revision。旧图片在修订保留期间仍可通过哈希读取。公开 API 供 Web、后续推荐及评测共用。

## 依据与限制

项目已锁定 Node 24 与 React/Vite 依赖。SQLite 不增加运行时服务和网络依赖，事务适合 Concept 与 Revision 原子写入。本地单用户是 MVP 范围；多进程写入、远端同步及迁移旧原型数据不在本阶段。

来源：[P1 规格](../../specs/concept-schema-crud-dashboard.md)、[产品契约](../../specs/product-contract.md)。
