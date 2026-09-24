# 0022：实施 Concept Schema、CRUD 与 Dashboard

Status: ready-for-agent

## 目标与范围

按 [P1 实施规格](../specs/concept-schema-crud-dashboard.md) 建立持久化 Concept Registry、本地 Card First Web、按语言资格判定、Revision 与真实目录 Dashboard。此任务承接 PRD 的 P1；当前尚未开始实施。

## 验收条件

- 规格中的 30 条用户故事和 Implementation Decisions 均有可观察的实现或明确的分阶段证据。
- 以临时数据目录运行真实服务读写和浏览器关键路径，验证持久化、双语隔离、资格转变、修订、归档/删除及 Dashboard 口径。
- 新增有回归价值的自动化测试，执行 `npm run check` 及实施时新增的产品验收命令；记录失败与未覆盖范围。

## 工作分工与进度

- 负责人：待实施 Agent；应用栈、存储与文件所有权在启动任务时确定。
- 进度：ready-for-agent；未写产品代码、未运行产品验收。

## 决策与未决事项

- 业务契约以规格为准；应用框架和存储产品需在动工前按项目流程记录决定。
- 独立 demo 仅供交互参考，不合并或复制生产代码。

## 验证证据

| 日期 | 命令或审查 | 结果 / 退出码 | 证据及未覆盖范围 |
| --- | --- | --- | --- |
| 待实施 | 产品验收与公共检查 | pending | 尚未实施，不能沿用 demo 或规格发布检查。 |

## 交接

从 [P1 实施规格](../specs/concept-schema-crud-dashboard.md) 与 [产品契约](../specs/product-contract.md) 开始；启动实施时新建或接管工作流状态，按实际实现更新证据。
