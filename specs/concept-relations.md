# Concept Relation 契约（0035）

依据 PRD §14–§18（历史文件 `docs/method-system-prd-v0.1.md`，见下方来源说明），Relation 是独立于 Concept、Tag、Recipe 的手工维护记录。0035 实现持久化和管理界面；推荐排序在 0036 接入。

## 存储与语义

- 独立 `concept_relations` 表保存 `id`、两端 Concept ID、`relation_type`、`note_cn`、`note_en`、版本和时间。两端必须是不同的现存 Concept；新增时均须处于 active 状态。
- `related_to`、`often_used_with`、`contrasts_with` 对称。写入前按 ID 排序，只存一条；反向重复提交返回 `duplicate_relation`。`extends`、`part_of` 保留来源和目标方向；反向关系若确有不同含义，可独立存在。同一来源、目标、类型只存一条。
- 中文和英文备注可分别为空，读取当前语言时只返回对应备注，不从另一语言回退。关系类型 ID 共用，名称由界面翻译。
- 每条关系为两端各写一条 `concept_references` 引用。关系与引用的新增、端点修改、删除在同一数据库事务完成。Concept 归档后仍保留引用；永久删除时有关系即拒绝，移除关系后才可删除。
- 编辑和删除要求 `expected_version`，旧版本返回 `version_conflict`。端点修改后引用随之转移。关系被编辑为已有的同向/对称组合时返回 `duplicate_relation`，原记录和引用保持不变。

## 读取与界面

- `GET /api/concepts/:id/relations?locale=cn|en` 从两端查询，每条带 `direction`：对称为 `symmetric`，有向按当前 Concept 为 `outgoing` 或 `incoming`；`other` 包含 ID、当前语言名称、生命周期状态及该语言浏览资格。
- 当前语言缺名称时只显示 ID 和缺失提示；不展示另一语言名称。已归档目标显示当前语言名称或 ID 及「已归档」标记，不提供跳转。极端数据异常导致目标缺失时显示 ID 和「目标缺失」标记；正常数据库外键阻止此状态出现。
- 详情页可新增、编辑、删除关系，列表页卡片不承载关系。新增界面只列出其他 active Concept；详情可显示已归档 Concept 的现有关系。`extends` 和 `part_of` 在目标端使用反向文案。

## API

- `POST /api/relations`：`{source_concept_id,target_concept_id,relation_type,note:{cn,en}}`，成功返回 201 和完整记录。
- `GET /api/relations/:id`：返回完整双语记录，供编辑器加载。
- `PATCH /api/relations/:id`：`{expected_version,changes}`，`changes` 可含端点、类型和部分或完整备注。
- `DELETE /api/relations/:id`：`{expected_version}`。

这些接口操作本地 Registry；Relation 不创建 Recipe，也不触发推荐或使用记录。

> 历史来源说明：旧产品材料已在 0045 合并删除；原文恢复方式见[文档收敛决策](../docs/adr/0004-product-doc-consolidation.md)。本文保留当时的任务或接口记录，不作为当前产品路线图。
