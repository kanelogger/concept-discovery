# 0029：展示真实目录 Dashboard

Status: done

实施记录：2026-09-25 在独立 `codex/concept-mvp-demo` 工作区启动；0027、0028 已完成并分别提交 `46b8be9`、`2b1ddc4`。Dashboard 从同一 Registry 和 Revision 计算，不写示例使用指标。

**Parent:** [P1 实施任务](0022-implement-concept-schema-crud-dashboard.md)

**What to build:** 管理员从独立 Dashboard 看到真实的活跃、草稿、各语言可浏览/可推荐、归档及最近修订数据，并能追溯这些数字来自同一份 Registry 与 Revision。

**Blocked by:** [0027：查看 Revision 并阻止过期编辑](0027-revision-history-conflicts.md)、[0028：归档、恢复与永久删除 Concept](0028-archive-restore-delete-concept.md).

## Acceptance criteria

- [x] 活跃总数、双语均为草稿数、`cn` / `en` 各自可浏览与可推荐数、归档数按 P1 规格口径从真实 Registry 计算；两种语言的计数不误当去重总数。
- [x] 最近修订来自真实 Revision，显示时间、Concept、影响语言和操作；永久删除的历史不计入。
- [x] 新建、补齐字段、降级、归档、恢复与永久删除后，Dashboard 数字和目录实际内容一致；用隔离数据验证边界与重启后的结果。
- [x] 尚未接入的 Usage/Feedback 和 Eval 只显示“尚未接入”或不展示，不使用原型示例数、伪造零值，也不提供 Playground 或 Prompt 展示。

## 实施与证据

- `GET /api/dashboard` 从现有 Concept 和 Revision 实时计算活跃总数、双语草稿、各语言可浏览/可推荐、归档数及最近 10 条真实修订；Revision 的语言路径用于标记 cn/en，归档和恢复标记双语。独立 Dashboard 页面呈现口径说明，并把 Usage/Feedback 和 Eval 标记为“尚未接入”。本票还补齐目录视图状态筛选及卡片中已填写类型的中英文标签。
- 隔离 HTTP 测试从空库起按新建、补齐双语配图与 Agent 字段、新建草稿、英文降级、归档、恢复、重启、永久删除推进，逐步断言 Dashboard 数字和修订列表；删除后只留下仍存在 Concept 的历史。浏览器以隔离库核对活跃 2、双语草稿 1、归档 1、cn 浏览/推荐 1/1、en 浏览/推荐 1/0；删除归档条目后刷新，归档数降至 0 且相关 Revision 消失。中文卡片显示“视角 · 启发式”，英文显示“Lens · Heuristic”，空类型不显示标签。临时库已删除。
- 2026-09-25：`npm run test:product` 7/7、`npm run check` 33/33、`npm run demo:build` 与 `git diff --check` 均通过。

## 未决与下一步

- P1 完成后按有限的 P2–P5 tickets 继续；推荐模型配置、离线 Eval Gate 等决策须先形成可实施契约，不能将 Dashboard 的“尚未接入”当作实际使用零值。
