# 0022：实施 Concept Schema、CRUD 与 Dashboard

Status: done

## 目标与范围

按 [P1 实施规格](../specs/concept-schema-crud-dashboard.md) 建立持久化 Concept Registry、本地 Card First Web、按语言资格判定、Revision 与真实目录 Dashboard。此任务由 0023–0029 七张纵向 tickets 完成。

## 验收条件

- 规格中的 30 条用户故事和 Implementation Decisions 均有可观察的实现或明确的分阶段证据。
- 以临时数据目录运行真实服务读写和浏览器关键路径，验证持久化、双语隔离、资格转变、修订、归档/删除及 Dashboard 口径。
- 新增有回归价值的自动化测试，执行 `npm run check` 及实施时新增的产品验收命令；记录失败与未覆盖范围。

## 工作分工与进度

- 负责人：`codex/concept-mvp-demo` 独立工作区；应用栈与存储见 [ADR 0002](../docs/adr/0002-local-product-stack.md)。
- 进度：0023–0029 全部完成，每张 ticket 均有独立本地提交、验收证据与实际执行的检查记录。

## 决策与未决事项

- P1 业务契约以规格为准；应用框架、Node HTTP 服务与 SQLite 存储已由 ADR 0002 记录。旧内存 demo 仅作交互参考。
- WebP 校验覆盖容器与首图像块签名，不执行完整像素解码；见 0025。未来 Relation/Usage 外部引用须写入 `concept_references` 才能维持永久删除限制；见 0028。

## 验证证据

| 日期 | 命令或审查 | 结果 / 退出码 | 证据及未覆盖范围 |
| --- | --- | --- | --- |
| 2026-09-25 | 0023–0029 逐票隔离 API 与浏览器验收 | passed | 草稿持久化、双语目录/图片、资格降级、修订冲突、归档/恢复/删除、Dashboard 转变与重启；详见各子 ticket。 |
| 2026-09-25 | `npm run test:product`、`npm run check`、`npm run demo:build` | passed | 0029 最终执行结果与退出码记录在其任务文件；公共检查含仓库校验和产品测试。 |

## 交接

P1 已具备本地验收条件；从 `npm start` 启动 Web 与同一 Registry。MVP 整体仍需 P2–P5，有限 ticket 范围将在下一任务中定稿。用户最终验收前不合并或部署。
