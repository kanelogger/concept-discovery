# 0035：维护 Concept Relation 与双语备注

Status: ready-for-agent

**What to build:** 手动维护 PRD 五种关系及 `cn`/`en` 备注，在 Concept 详情按当前语言展示，保持 Relation 与 Recipe 分离。

**Blocked by:** [0034：离线推荐评测入口](0034-offline-eval-harness.md).

## Acceptance criteria

- [ ] 独立关系表支持 `related_to`、`often_used_with`、`contrasts_with`、`extends`、`part_of`；校验两端 Concept、去重及对称/有向语义。
- [ ] 双语 Note 独立保存；详情只展示当前语言名称与备注，不做跨语言回退；缺失目标或已归档目标的展示规则有明确契约。
- [ ] Relation 写入 `concept_references` 或等效受同一事务保护的引用约束，永久删除有引用的 Concept 被拒绝；移除关系后可删除。
- [ ] 隔离 API 和浏览器覆盖新增、编辑、删除、方向、语言与引用限制；公共检查通过。
