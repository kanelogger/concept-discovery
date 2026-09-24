# 后续产品任务

状态：以下产品任务均未启动。Skillbox 本地源码仅作为参考；本次文档修订不建立产品服务、正式 Registry 或业务 Skill。

任务启动前按 [协作流程](../workflow/README.md) 创建独立任务文件，写明范围、验收和证据；产品命名、字段冲突与未决问题见 [产品方向与待定契约](../specs/product-contract.md)。

实施前置：先定稿 Concept/推荐结果 Schema（含 `locales.cn` / `locales.en`、双语 WebP 与 `locale` 输入输出）、生命周期与 Core 准入规则；核验首批条目来源、英文内容及翻译质量并逐条审核；记录本地应用栈、存储和模型数据流的选择。这些准备工作服务五阶段主线，不构成 Fork 阶段。

| 顺序 | MVP 主线 | 前置条件 | 完成验收 |
| --- | --- | --- | --- |
| 1 | Concept CRUD | Schema、双语准入记录和技术选型 | 同一 Registry 支撑本地 Card First Web；卡片可切换 `cn` / `en` 标题、描述、WebP 配图和标签，类型跨语言共用；可分别编辑、按语言搜索、归档/删除、查看修订；无效输入不破坏有效数据。优先参考 Skillbox Web/CRUD/Revision/Search。 |
| 2 | Recommendation Playground | 有双语齐备且已审核的 Concept；模型与数据流决定 | Playground 向正式推荐接口传 `locale`，输出同语言诊断、Why Now 和 0–3 个推荐或空结果；Apply 生成同语言 Prompt；代表案例覆盖 `cn` / `en`、无推荐和禁用条件。优先参考 Skillbox Recommend，并建立初始离线 Eval 样本。 |
| 3 | Concept Relation | Concept CRUD 与推荐接口可用 | 手动维护五种关系和 `cn` / `en` 备注，校验引用和方向；详情按语言展示关系，轻量推荐信号有可复现案例；不引入 Recipe。 |
| 4 | Concept Discovery Skill | Playground、Relation 和 Prompt Composer 可用 | Agent 与 Web 读取同一 Registry、调用同一推荐接口；传递用户 `locale`，选择后生成并执行同语言 Prompt，空推荐正常继续。 |
| 5 | Feedback / Eval | Skill 接入；事件语义与标识定稿 | 记录推荐、查看、应用、忽略、无帮助及 `locale`，区分 Playground 与真实使用；核对 Usage 统计，运行覆盖双语的离线和真实使用评估，并据 MVP Gate 决定是否扩大。优先参考 Skillbox Usage Reporting。 |

首批准入仍须记录 `daily-knowledge(1).md` 的缺失或取得情况；六项优先补来源的是第一性原理、逆向思维、第二层思维、事件—局势—结构、安全边际、古德哈特定律，依据 [清洗稿 §6](../docs/method-registry-curated-v0.1.md#6-后续补充优先级)。清洗稿 30 项全部要逐条审核，并补充可核验的英文内容及各语言配图；只有双语校验通过的数据进入正式推荐池。

Markdown 批量导入、JSON/Markdown 导出、Dashboard、Embedding、复杂 Rerank、用户偏好与 Recipe 推荐暂不排入主线；需要时依据真实使用证据另开任务。MVP 排除项见 [PRD §36](../docs/method-system-prd-v0.1.md#36-mvp-明确不做)。
