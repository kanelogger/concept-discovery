# 0029：展示真实目录 Dashboard

Status: ready-for-agent

**Parent:** [P1 实施任务](0022-implement-concept-schema-crud-dashboard.md)

**What to build:** 管理员从独立 Dashboard 看到真实的活跃、草稿、各语言可浏览/可推荐、归档及最近修订数据，并能追溯这些数字来自同一份 Registry 与 Revision。

**Blocked by:** [0027：查看 Revision 并阻止过期编辑](0027-revision-history-conflicts.md)、[0028：归档、恢复与永久删除 Concept](0028-archive-restore-delete-concept.md).

## Acceptance criteria

- [ ] 活跃总数、双语均为草稿数、`cn` / `en` 各自可浏览与可推荐数、归档数按 P1 规格口径从真实 Registry 计算；两种语言的计数不误当去重总数。
- [ ] 最近修订来自真实 Revision，显示时间、Concept、影响语言和操作；永久删除的历史不计入。
- [ ] 新建、补齐字段、降级、归档、恢复与永久删除后，Dashboard 数字和目录实际内容一致；用隔离数据验证边界与重启后的结果。
- [ ] 尚未接入的 Usage/Feedback 和 Eval 只显示“尚未接入”或不展示，不使用原型示例数、伪造零值，也不提供 Playground 或 Prompt 展示。
