# 0028：归档、恢复与永久删除 Concept

Status: ready-for-agent

**Parent:** [P1 实施任务](0022-implement-concept-schema-crud-dashboard.md)

**What to build:** 管理员能先归档不再使用的 Concept，使两种语言退出普通浏览及后续推荐；必要时恢复，或在安全条件满足时永久删除。

**Blocked by:** [0026：显示各语言可推荐资格与降级影响](0026-recommendable-locale-readiness.md).

## Acceptance criteria

- [ ] 归档前提示对两种语言的影响；归档后普通卡片、搜索和可推荐结果均不含该 Concept，管理视图仍可按状态找到它。
- [ ] 恢复后按当前字段重新计算 `cn` / `en` 资格；归档与恢复均产生版本及 Revision。
- [ ] 永久删除只允许已归档且无外部引用的 Concept，并要求二次确认；成功时记录、媒体和修订一并移除，失败时不发生部分删除。
- [ ] 浏览器和公开操作测试覆盖归档、恢复、状态筛选、删除限制及两种语言资格变化。
