# 后续产品任务

状态：P1 的 0023–0029 已在独立 `codex/concept-mvp-demo` 工作区完成；P2–P5 尚未实施。Skillbox 本地源码仅作为参考。

任务启动前按 [协作流程](../workflow/README.md) 创建独立任务文件，写明范围、验收和证据；产品命名、字段冲突与未决问题见 [产品方向与待定契约](../specs/product-contract.md)。

P1 的 [Concept Schema、CRUD 与 Dashboard 规格](../specs/concept-schema-crud-dashboard.md) 由 [上层实施任务](0022-implement-concept-schema-crud-dashboard.md)及 [0023](0023-persist-concept-draft.md)、[0024](0024-bilingual-browse-search.md)、[0025](0025-localized-image-wiki.md)、[0026](0026-recommendable-locale-readiness.md)、[0027](0027-revision-history-conflicts.md)、[0028](0028-archive-restore-delete-concept.md)、[0029](0029-real-registry-dashboard.md) 七张纵向 tickets 完成。目录生命周期和各语言可浏览/可推荐资格已可运行，出处只检查非空、不执行外部核验。推荐结果 Schema 与模型配置属于 P2 前置工作。旧 `type` 映射留到明确的导入任务，不阻塞手工 Concept CRUD。

| 顺序 | MVP 主线 | 前置条件 | 完成验收 |
| --- | --- | --- | --- |
| 1 | [Concept CRUD](0022-implement-concept-schema-crud-dashboard.md) · 0023–0029 已完成 | [P1 规格](../specs/concept-schema-crud-dashboard.md)与 [ADR 0002](../docs/adr/0002-local-product-stack.md) | 同一 Registry 支撑本地 Card First Web；卡片按 `cn` / `en` 展示对应内容和 WebP，普通术语可先入目录，未填类型时卡片不显示类型；可分别编辑出处文本与 Wiki 链接、按语言搜索、归档/删除、查看修订。Dashboard 展示目录和各语言推荐资格；无效输入不破坏有效数据。验收证据见 0023–0029。 |
| 2 | Recommendation API / Eval Harness | 至少一个语言有可推荐的 Concept；模型配置与数据流定稿 | 开发用评测入口向正式推荐接口传 `locale`，得到同语言诊断、Why Now 和 0–3 个推荐或空结果；用例覆盖 `cn` / `en`、无推荐和禁用条件，不写真实使用日志。Web 无 Playground 或 Prompt 展示。优先参考 Skillbox Recommend。 |
| 3 | Concept Relation | Concept CRUD 与推荐接口可用 | 手动维护五种关系和 `cn` / `en` 备注，校验引用和方向；详情按语言展示关系，轻量推荐信号有可复现案例；不引入 Recipe。 |
| 4 | Concept Discovery Skill | 推荐接口、Relation 和 Prompt Composer 可用 | 只在用户以命令或明确自然语言请求调用时运行；Agent 与 Web 读取同一 Registry，按用户 `locale` 推荐，用户选择后生成并执行同语言 Prompt；无模型时提示配置或选择，未经选择不上传上下文。 |
| 5 | Feedback / Eval | Skill 接入；事件语义与标识定稿 | 只记录 Skill 的真实推荐、查看、应用、忽略、无帮助及 `locale`；Dashboard 展示 Usage 统计，离线评测与真实使用分开。按 MVP Gate 决定是否扩大。优先参考 Skillbox Usage Reporting。 |

首批目录候选仍须记录 `daily-knowledge(1).md` 的缺失或取得情况；六项优先补来源的是第一性原理、逆向思维、第二层思维、事件—局势—结构、安全边际、古德哈特定律，依据 [清洗稿 §6](../docs/method-registry-curated-v0.1.md#6-后续补充优先级)。候选可先存草稿；某语言有名称、描述和非空出处文本后可浏览，补齐配图、触发场景和 Agent Instruction 后可参与推荐。30 个双语齐备的目标用于扩张 Gate。

Markdown 批量导入、JSON/Markdown 导出、Web Recommendation Playground、Embedding、复杂 Rerank、用户偏好与 Recipe 推荐暂不排入主线；需要时依据真实使用证据另开任务。MVP 排除项见 [PRD §36](../docs/method-system-prd-v0.1.md#36-mvp-明确不做)。
