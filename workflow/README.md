# 任务流程与交接

目标：没有历史对话的新会话能从仓库知道当前做到哪里、证据是什么、下一步做什么。

## 开始与执行

1. 读取根 `AGENTS.md`、[状态文件](../workflow-state.json) 及其 `task_file`，检查工作树和相关事实。先核实历史结论，不默认继续已完成任务。
2. 新任务在 `tasks/` 创建独立编号文件，参考 [任务模板](task-template.md)。写明目标、范围、验收、已获授权和重要未决问题。
3. 更新状态的 `task_id` / `task_file` / `summary`，将 `phase` 设为 `planning`，清空上一任务的 `verification` 与阻塞。`task_file` 使用 `tasks/<task_id>.md`；按本次风险设定非空 `required_checks`。仅加载当前阶段所需资料。
4. 进入 `implementation` 后分配文件所有权并实现。常规可逆工作连续完成；只对会改变产品方向且无法从上下文解决的歧义询问用户，继续不依赖答案的工作。
5. 进入 `verification`，执行相称检查；失败回到 `implementation` 修复。更新任务中的实际结果、风险和 `next_actions`。
6. 验收成立后进入 `complete`，本地审查并提交任务相关改动。保留任务文件作为历史记录；新任务切换指针，不覆盖旧任务证据。

## 状态约定

`workflow-state.json` 是工作交接快照，不是权限系统、锁或自动调度器。人工和 Agent 都可按上述流程编辑，并运行 `npm run validate`。

| phase | 含义与应做的事 |
| --- | --- |
| `planning` | 确定范围、输入和验收；需要时形成具体方案 |
| `implementation` | 已授权范围内实现并记录重要取舍 |
| `verification` | 运行检查、审查差异与恢复路径 |
| `blocked` | 必要信息或能力缺失；`blockers` 写清原因及解除条件 |
| `complete` | 当前任务验收完成，`blockers` 为空，保留验证证据 |

`updated_at` / `recorded_at` 使用有效 ISO 日期或带时区的时间。`required_checks` 列出本次必需命令：初始化和环境工具变更使用 `npm run doctor`、`npm run check`；文档小改可用 `npm run validate`；业务功能增加对应验收命令。选择依据见 [验证规则](../rules/testing.md)。

`verification` 每项记录非空 `command`、`result`（`passed` / `failed` / `skipped`）、`recorded_at`；记录按执行顺序追加。完成态要求 `required_checks` 中每条命令的最后一条记录为实际执行后的 `passed`。检查器只验证结构和一致性，不执行记录中的命令，也不能证明结果真实。具体行为验收证据保留在任务文件。

环境基线变化时同步更新检查器、测试、CI 和本说明。不要为通过校验虚填结果。尚未完成的产品功能放在 [待办](../tasks/backlog.md)，不作为本次初始化的阻塞。

## 事实与长期记忆

- 当前契约放 `specs/`；已有代码、配置和 Schema 能表达的事实直接引用，不复制。
- 一次任务的进度、失败和取舍放 `tasks/`。跨任务仍有影响的决定放 `docs/adr/`，注明来源、日期、适用范围；被替代时链接新决定。
- 原始材料留在 `docs/` 并注明状态；契约与材料冲突时回到证据，不静默采用最新文本。
- 项目级 Skill、Hook 和 Connector 只在出现可复用需求时新增，并记录前置条件、权限与验证方法。

## 新会话验收

仅从 `AGENTS.md` 出发，应能回答：产品是否可运行、当前任务是否完成、如何执行检查、什么尚未决定、下一步做什么。路径失效由 `validate` 检出，内容真实性需独立阅读核实；此检查在变更入口或交接方式时执行。
