# 后续产品任务

更新：2026-09-28。当前产品范围以[需求文档](../docs/需求文档.md)和[产品设计文档](../docs/产品设计文档.md)为准；此处只维护执行顺序与历史任务索引。

## 恢复项目后的优先项

1. 维护者人工审阅 `data/examples/knowledge-base-v1.json` 中 12 条双语内容及来源，完成内容签收；Agent 来源核验见 0050；[0052](0052-sample-review-preparation.md) 提供修订后的隔离审阅库和逐条审阅要点。
2. 使用隔离样本库体验后进入 30 天实际使用，记录持续新增、旧知识重新发现和关系探索的具体例子。
3. 根据上述证据决定认知自动补全与 CLI / Skill / 对外 API / MCP 的具体接入顺序。

文档收敛记录见 [0045](0045-consolidate-product-docs.md)。AI 提取、Inbox、批量导入导出产品界面和个性化未排入当前实施范围。

## 已有实现与历史任务

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

[0040 旧 MVP Eval Gate](0040-mvp-eval-acceptance.md) 尚未完成，留待恢复推荐阶段时重新确认验收范围、真实案例和通过门槛；它不阻塞新 Web 阶段，也不能宣称已通过。

新任务按[协作流程](../workflow/README.md)建档，保留个人数据并记录实际验证证据。

## 当前实施

[0046 总任务](0046-web-knowledge-base.md)的 0047–0050 已完成；0051 记录服务与浏览器验收及交互修正。人工内容签收与 30 天使用验证不计为自动化完成。

## 0040 正式质量验收 TODO

保留旧个人试用阶段的待办；恢复推荐阶段时重新确认范围和通过线，不阻塞当前 Web 阶段：

- [ ] 收集至少 25 条经同意、去标识化的真实任务及不含原文的来源编号；不使用测试调用或 synthetic 数据补数。
- [ ] 维护者逐条复核 Expected、`locale` 与来源，冻结至少 50 条正式双语 Eval 案例。
- [ ] 自然积累并核对真实用户主动调用 Skill 的 Usage、双语分布与 Apply Rate；现有数据尚未确认为正式 Gate 证据。
- [ ] 使用冻结数据集运行正式离线评测和数值判定，人工复核诊断、Why Now、目录出处与内容质量；在 [0040](0040-mvp-eval-acceptance.md) 中记录最终 Gate 结论。

## 阶段收口

用户要求项目告一段落、全部任务合入本地 main 并关闭服务；执行证据见 [0053](0053-merge-main-stop-services.md)。未完成的人工签收、使用验证与质量 Gate 保留为后续事项。

## 0055 Web 搜索推荐

[显式搜索与推荐抽屉](0055-explicit-search-recommendation-drawer.md)已合入本地 main 并在原个人库重启验证；以可浏览 Concept 为候选，原 Agent 推荐资格与 0040 质量 Gate 不变。

## 0058 个人库六条精选数据

[个人库重置](0058-reset-personal-concept-library.md)完成后，按用户后续要求由 [0059](0059-unify-local-database.md) 清理重复库与所有历史快照；当前只保留默认库。

## 0060 README 隔离样本说明

[排障与文档修正](0060-remove-confusing-isolated-demo-example.md)确认旧 README 命令会切换到 12 条样本的独立库；已删除误生成的临时文件，并把该命令标为隔离验收用途。
