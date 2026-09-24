# 0030：发布 P1 纵向实现 tickets

## 目标与范围

按用户确认的七张纵向切片，将 [P1 实施规格](../specs/concept-schema-crud-dashboard.md) 拆为有明确阻塞关系的本地 tickets。每张 ticket 保持可独立演示或验证；原 [P1 上层任务](0022-implement-concept-schema-crud-dashboard.md) 保持不变。

## 验收条件

- 七张 ticket 各有独立任务文件、`ready-for-agent` 状态、用户可观察的交付行为、验收条件和显式 `Blocked by`。
- 依赖图无环；只有无阻塞的首张 ticket 处于可立即开工前沿。
- 更新 backlog 与工作流状态，运行 `npm run validate` 和 `git diff --check`，审查后独立提交。

## 工作分工与进度

- 负责人：主 Agent；仅维护本次 tickets、backlog、本任务记录和工作流状态。
- 进度：七张 tickets 已发布，依赖图与文档校验通过；产品实施尚未开始。

## 决策与未决事项

- 2026-09-25：用户确认七张 ticket 的粒度、阻塞关系与无需增删。0026 与 0027 可并行；0029 等两条分支完成。
- 项目已配置本地 Markdown issue tracker，按项目约定使用 `tasks/`，不创建平行的 `.scratch/` 目录。保留 0022 上层任务，不关闭或修改。
- 当前无产品代码，无须为拆分工作单开横向重构 ticket；应用栈和存储选型包含在第一张可演示切片。

## 验证证据

| 日期 | 命令或审查 | 结果 / 退出码 | 证据及未覆盖范围 |
| --- | --- | --- | --- |
| 2026-09-25 | `npm run validate` | passed / 0 | 工作流状态、必需路径及 47 份 Markdown 本地链接通过；不代表产品功能已实现。 |
| 2026-09-25 | `git diff --check` | passed / 0 | 当前修改无空白错误。 |
| 2026-09-25 | 依赖图脚本与人工验收覆盖审查 | passed / 0 | 七张 ticket 编号与链接完整，依赖顺序无环；仅 0023 无阻塞，0029 由 0027 和 0028 阻塞。 |

## 交接

从无阻塞的 [0023：持久化 Concept 草稿](0023-persist-concept-draft.md) 开始。其余 ticket 按各自 `Blocked by` 推进；不沿用原型演示或本次文档校验作为产品验收证据。
