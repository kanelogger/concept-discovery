# 0035：维护 Concept Relation 与双语备注

Status: done

实施记录：2026-09-25 在独立 `codex/concept-mvp-demo` 工作区启动；前置 0034 已以 `cbccea4` 提交。对称关系采用规范化端点只存一条，有向关系保留输入方向；归档目标展示当前语言名称或 ID 与状态，不跨语言回退。

**What to build:** 手动维护 PRD 五种关系及 `cn`/`en` 备注，在 Concept 详情按当前语言展示，保持 Relation 与 Recipe 分离。

**Blocked by:** [0034：离线推荐评测入口](0034-offline-eval-harness.md).

## Acceptance criteria

- [x] 独立关系表支持 `related_to`、`often_used_with`、`contrasts_with`、`extends`、`part_of`；校验两端 Concept、去重及对称/有向语义。
- [x] 双语 Note 独立保存；详情只展示当前语言名称与备注，不做跨语言回退；缺失目标或已归档目标的展示规则有明确契约。
- [x] Relation 写入 `concept_references` 或等效受同一事务保护的引用约束，永久删除有引用的 Concept 被拒绝；移除关系后可删除。
- [x] 隔离 API 和浏览器覆盖新增、编辑、删除、方向、语言与引用限制；公共检查通过。

## 实施与证据

- [关系契约](../specs/concept-relations.md)定义对称规范化、有向方向、双语与归档展示、引用事务和 HTTP API。SQLite 独立关系表加唯一约束；两端引用与关系写入、端点变更、删除同事务。Web 详情提供管理表单，不跨语言回退或把 Relation 当 Recipe。
- `node --test tests/relations.test.mjs`：3/3 通过（2026-09-25）。覆盖双语、对称反向去重、有向两端方向、重启持久化、归档目标、引用删除限制、端点迁移、重复编辑回滚与版本冲突。测试使用临时 SQLite 并清理。
- 本地浏览器连接隔离 SQLite：创建 `alpha often_used_with beta`、分别查看中文/英文备注；改为 `alpha extends beta` 后在 `beta` 侧看到 `Extended by ← Alpha Concept`；通过界面删除后显示 `No relations yet`。此浏览器检查不涉及用户 Registry，结束后关闭服务并删除隔离 DB。
- `npm run check`：52/52 通过（2026-09-25）；`npm run demo:build`、`git diff --check` 通过。未运行外网调用，本票不使用临时模型密钥。

## 未决与下一步

Relation 作为推荐同分排序信号留给 [0036](0036-relation-ranking-signal.md)。目标缺失的界面分支只是针对异常数据的防护；正常外键约束阻止删除仍被关系引用的 Concept。
