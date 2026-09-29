# 后续事项与历史任务索引

更新：2026-09-28。当前产品范围以[需求文档](../docs/需求文档.md)和[产品设计文档](../docs/产品设计文档.md)为准。先看未完成事项；后半部分仅供追溯既有实现和历史决策。

## 当前未完成事项

1. [ ] 维护者人工审阅 `data/examples/knowledge-base-v1.json` 中 12 条双语内容及来源，完成内容签收；Agent 来源核验见 [0050](0050-knowledge-samples.md)，[0052](0052-sample-review-preparation.md) 提供逐条审阅要点。
2. [ ] 从真实任务开始记录 30 天使用情况：持续新增、旧知识重新发现、关系探索带来的帮助，以及无结果或没帮助的情况。隔离样本体验不计为真实使用证据。
3. [ ] 根据内容签收和实际使用证据，决定认知自动补全与 CLI / Skill / 对外 API / MCP 的具体接入顺序。
4. [ ] 恢复推荐阶段时重新确认并完成 [0040 正式质量验收](0040-mvp-eval-acceptance.md)；旧个人试用验收不代表此 Gate 通过，具体待办见下文。

AI 提取、Inbox、批量导入导出产品界面和个性化未排入当前实施范围。新任务按[协作流程](../workflow/README.md)建档，保留个人数据并记录实际验证证据。

## 0040 正式质量验收 TODO

保留旧个人试用阶段的待办；恢复推荐阶段时重新确认范围和通过线，不阻塞当前 Web 阶段：

- [ ] 收集至少 25 条经同意、去标识化的真实任务及不含原文的来源编号；不使用测试调用或 synthetic 数据补数。
- [ ] 维护者逐条复核 Expected、`locale` 与来源，冻结至少 50 条正式双语 Eval 案例。
- [ ] 自然积累并核对真实用户主动调用 Skill 的 Usage、双语分布与 Apply Rate；现有数据尚未确认为正式 Gate 证据。
- [ ] 使用冻结数据集运行正式离线评测和数值判定，人工复核诊断、Why Now、目录出处与内容质量；在 [0040](0040-mvp-eval-acceptance.md) 中记录最终 Gate 结论。

## 历史索引：已有实现

以下 P1–P5 是旧路线的编号。既有实现作为新阶段的基础保留，不要求按旧顺序重做，也不以旧 Goal 自动扩展当前任务。

| 既有工作 | 记录 |
| --- | --- |
| Registry、双语 CRUD、图片、资格、修订与 Dashboard | [0022 上层任务](0022-implement-concept-schema-crud-dashboard.md)，0023–0029 |
| 推荐契约、模型适配与正式接口 | [0032](0032-recommendation-contract-model-adapter.md)、[0033](0033-recommendation-api.md) |
| 离线评测机制 | [0034](0034-offline-eval-harness.md) |
| 关系维护与推荐排序信号 | [0035](0035-concept-relation-crud.md)、[0036](0036-relation-ranking-signal.md) |
| Composer、Skill 与 Usage/Feedback | [0037](0037-contextual-prompt-composer.md)、[0038](0038-concept-discovery-skill.md)、[0039](0039-skill-feedback-usage.md) |
| 后续 Web 验收修正 | [0041](0041-management-library-domain-picker.md)、[0042](0042-concept-multi-image-upload.md)、[0043](0043-soft-delete-terminology.md) |
| Web 阶段计划保存记录 | [0044](0044-save-concept-knowledge-base-plan.md)，计划已并入当前设计 |

## 历史索引：Web 阶段与收口

| 记录 | 已完成工作及证据 |
| --- | --- |
| [0045 文档收敛](0045-consolidate-product-docs.md) | 产品文档收敛为一份需求和一份设计；历史决定见 [ADR 0004](../docs/adr/0004-product-doc-consolidation.md)。 |
| [0046 Web 总任务](0046-web-knowledge-base.md)、[0051 Web 验收](0051-web-acceptance.md) | 0047–0050 的字段、搜索导航和样本工作已实施；0051 记录服务与浏览器验收。人工签收与真实使用仍见上方待办。 |
| [0052 样本审阅准备](0052-sample-review-preparation.md) | Agent 复核和隔离审阅准备已完成，维护者签收待执行。 |
| [0053 阶段收口](0053-merge-main-stop-services.md) | 已将该阶段工作合入本地 main 并停止当时服务；不等于 0040 正式质量 Gate 通过。 |
| [0055 Web 搜索推荐](0055-explicit-search-recommendation-drawer.md) | 显式搜索与 DeepSeek 推荐抽屉已实现，原 Agent 推荐资格不变。 |
| [0058 个人库重置](0058-reset-personal-concept-library.md)、[0059 统一数据库](0059-unify-local-database.md) | 个人库改为六条精选数据，后续统一到默认库；旧重复库与快照已按用户要求清理。 |
| [0060 隔离样本说明](0060-remove-confusing-isolated-demo-example.md) | 日常启动与独立 12 条样本库的用途已区分，误生成的临时库已删除。 |
| [0062 文章详情方案](0062-article-detail-options.md)、[0063 文章详情实现](0063-article-detail-page.md) | 方案 B 采用每种语言独立文章正文；完整阅读页、旧条目兼容与验证见实施记录。 |
