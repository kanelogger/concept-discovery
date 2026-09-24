# 0036：将 Relation 用作轻量推荐排序信号

Status: ready-for-agent

**What to build:** 只在候选适用、未命中 `avoid_when`、与已选项互补且同分时，用 Relation 决定推荐顺序。

**Blocked by:** [0035：Concept Relation CRUD](0035-concept-relation-crud.md).

## Acceptance criteria

- [ ] `often_used_with` 等关系仅在明确的互补同分案例改变顺序，不强行增加推荐数、不给关系叠加数值权重。
- [ ] 不适用、归档或触发避免条件的目标不能靠关系进入结果；`extends`/`part_of` 方向解释保持一致。
- [ ] 可复现测试比较有无关系的推荐结果，并记录假模型与真实模型的验证边界；公共检查通过。
