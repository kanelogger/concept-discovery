# ADR 0004：产品文档收敛为需求与设计

日期：2026-09-27。状态：accepted。依据：用户在[任务 0045](../../tasks/0045-consolidate-product-docs.md)中明确要求统一产品思路并删除重复文档。

## 决定

产品只维护[需求文档](../需求文档.md)和[产品设计文档](../产品设计文档.md)。长期目标为认知自动补全，近期按已确认的 Web 知识库计划推进。技术规格、ADR 和历史任务保留证据职责，不另立产品路线图。

删除调研稿、阶段计划、旧 PRD、Registry 清洗稿及 `docs/README.md`。旧候选清单不迁入需求正文，不再以 Core/Pack 分类决定收录或推荐资格。现有知识数据和产品代码不变。

## 来源与恢复

被删除的已跟踪材料位于修订 `f373ade9e7ccb8e93259525131975a97af9167cc`：

- `docs/method-system-prd-v0.1.md`
- `docs/method-registry-curated-v0.1.md`
- `docs/concept-knowledge-base-phase-1-plan.md`
- `docs/README.md`
- `specs/product-contract.md`（旧版内容；当前文件保留为精简索引）

使用 `git show f373ade9e7ccb8e93259525131975a97af9167cc:路径` 查阅原文。历史任务中对旧材料的链接改为保留名称、章节及路径的历史来源注记，不伪装为新文档的来源。原有未跟踪调研和设计输入的本机临时备份位置见任务记录。

## 影响

第一阶段不继承旧草稿的 AI 提取、Inbox、自动推荐及稳定对外 API 承诺；未来接入端按实际需要推进。旧规格中的 P1–P5 和旧 MVP Gate 不作为新 Web 阶段的前置条件。后续实现需按设计文档同步技术规格并验证，不因本次整理宣称完成。
