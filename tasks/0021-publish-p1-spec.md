# 0021：发布 Concept Schema、CRUD 与 Dashboard 规格

## 目标与范围

依据 PRD、[领域词汇表](../CONTEXT.md)、[产品契约](../specs/product-contract.md)和独立原型结论，形成 [P1 实施规格](../specs/concept-schema-crud-dashboard.md)，并在本地 issue tracker 发布待实施任务。此次只交付规格，不实现产品。

## 验收条件

- 规格覆盖用户列出的 Schema、按语言资格、纯文本出处、图片和 Wiki、Revision、Card First CRUD、Dashboard 数据来源及 Web 排除项。
- 待实施任务标记 `Status: ready-for-agent`，指向唯一正式规格。
- 运行 `npm run validate`、`git diff --check`，审查依据与差异并独立提交。

## 工作分工与进度

- 负责人：主 Agent；负责本任务、P1 规格、待实施任务、产品索引和工作流状态。
- 进度：规格与待实施任务已发布，文档校验和来源审查通过；产品实施尚未开始。

## 决策与未决事项

- 采用真实 Registry 服务读写加浏览器关键路径作为最高层验收缝；非法数据与并发冲突通过同一公开操作验证。现有仓库只有环境测试，暂无产品测试入口。
- 原型 A/B 首页仍并存；P1 以 PRD 的 Card First 原则选择卡片库首页，Dashboard 作独立导航。原型 C 已移除。
- 应用框架与存储选型仍须在实施前按项目工作流记录；不阻塞本次规格发布。
- 本次规格明确状态和修订规则，但不创建 ADR；后续技术选型若符合 ADR 条件再记录。

## 验证证据

| 日期 | 命令或审查 | 结果 / 退出码 | 证据及未覆盖范围 |
| --- | --- | --- | --- |
| 2026-09-24 | `npm run validate` | passed / 0 | 工作流状态、必需路径及 39 份 Markdown 本地链接通过；不代表产品功能通过。 |
| 2026-09-24 | `git diff --check` 与来源审查 | passed / 0 | 无空白错误；核对 PRD、CONTEXT、产品契约及 demo 任务记录，未将原型指标或代码视为生产事实。 |

## 交接

完成后由 [P1 实施任务](0022-implement-concept-schema-crud-dashboard.md) 承接；正式实现不得把独立 demo 当作已实现能力。
