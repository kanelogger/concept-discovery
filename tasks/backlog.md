# 后续产品任务

更新：2026-09-27。当前产品范围以[需求文档](../docs/需求文档.md)和[产品设计文档](../docs/产品设计文档.md)为准；此处只维护执行顺序与历史任务索引。

## 当前优先项

1. 按设计文档另建 Web 知识库实施任务，同步受影响的技术契约。
2. 实施诊断问题与案例字段、触发场景优先的阅读体验、扩展关键词搜索、关系预览和详情连续导航。
3. 整理约 12 条双语样本，核实出处并在隔离库完成服务、浏览器与内容验收。
4. 第一阶段使用验证后，再决定认知自动补全与 CLI / Skill / 对外 API / MCP 的具体接入顺序。

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
