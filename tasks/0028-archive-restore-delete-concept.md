# 0028：归档、恢复与永久删除 Concept

Status: done

实施记录：2026-09-25 在独立 `codex/concept-mvp-demo` 工作区启动；0027 已完成并提交 `46b8be9`。本票增加专用生命周期操作、管理视图归档筛选与受限制的永久删除；测试只使用隔离临时 Registry。

**Parent:** [P1 实施任务](0022-implement-concept-schema-crud-dashboard.md)

**What to build:** 管理员能先归档不再使用的 Concept，使两种语言退出普通浏览及后续推荐；必要时恢复，或在安全条件满足时永久删除。

**Blocked by:** [0026：显示各语言可推荐资格与降级影响](0026-recommendable-locale-readiness.md).

## Acceptance criteria

- [x] 归档前提示对两种语言的影响；归档后普通卡片、搜索和可推荐结果均不含该 Concept，管理视图仍可按状态找到它。
- [x] 恢复后按当前字段重新计算 `cn` / `en` 资格；归档与恢复均产生版本及 Revision。
- [x] 永久删除只允许已归档且无外部引用的 Concept，并要求二次确认；成功时记录、媒体和修订一并移除，失败时不发生部分删除。
- [x] 浏览器和公开操作测试覆盖归档、恢复、状态筛选、删除限制及两种语言资格变化。

## 实施与证据

- 新增按所见版本检查的 `archive`、`restore` 与 `DELETE` 公开操作。归档/恢复各写一条 `lifecycle_status` Revision；管理视图提供“已归档”筛选和明确标签，普通浏览与各语言推荐查询均排除归档记录。归档前确认显示 cn/en 原资格与退出范围。
- 永久删除要求归档、最新版本、匹配 ID；界面先输入完整 ID，再作不可撤销确认。服务端事务中检查 `concept_references`，删除记录与级联修订，并清理该 Concept 当前及历史引用中没有被其他 Concept/Revision 共用的图片。后续 Relation/Usage 写入外部引用时须登记同一表，才能保持删除限制。
- 隔离 HTTP 测试覆盖双语归档退出、管理筛选、重复归档无新版本、恢复资格与 Revision、活动记录不可删除、外部引用拒绝且无部分删除、错误确认 ID、过期版本，以及删除后记录/修订/专属图片消失而共用图片保留。浏览器测试覆盖中英文退出普通浏览、归档筛选、恢复到英文可推荐 v4、归档 v5，以及两次删除确认的取消与最终删除。临时测试库已删除。
- 2026-09-25：`npm run test:product` 6/6、`npm run check` 32/32、`npm run demo:build` 与 `git diff --check` 均通过。

## 未决与下一步

- 0029 完成真实 Registry 驱动的 Dashboard 与端到端 P1 验收。外部引用登记目前只提供存储约束，P3 Relation 和 P5 Usage 接入时必须写入 `concept_references`。
