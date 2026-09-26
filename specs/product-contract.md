# 产品方向与待定契约

状态：产品方向索引；P1 的 Concept Schema、CRUD 与 Dashboard 已有可实施规格，其余产品契约仍待逐阶段定稿。此文件从两份产品输入提取边界，不将 Draft 示例提升为已实现能力。

## 已确认的产品方向

- Concept 是有名称和可说明出处的专业领域术语或方法论术语。用户明确调用 Skill 后，系统从当前任务中发现值得考虑的 Concept，解释推荐原因，并在用户选择后生成上下文化 Prompt。参见 [PRD §1、§3](../docs/method-system-prd-v0.1.md#1-产品定义)。
- 产品由本地 Concept System（Registry + 推荐引擎）和薄的 Concept Discovery Skill 组成；Registry 是 Web、Skill 与开发用评测入口共享的唯一事实源。参见 [PRD §7](../docs/method-system-prd-v0.1.md#7-产品组成)、[§38](../docs/method-system-prd-v0.1.md#38-最终产品结构)。
- Diagnose → Recommend → 用户选择 → Compose → 应用是目标流程。默认推荐 1 个、最多 3 个，允许空推荐，用户保留应用决定权。参见 [PRD §22](../docs/method-system-prd-v0.1.md#22-recommendation-输出)、[§23](../docs/method-system-prd-v0.1.md#23-推荐规则)、[§24](../docs/method-system-prd-v0.1.md#24-推荐流程)、[§26](../docs/method-system-prd-v0.1.md#26-prompt-composer)。
- 第一阶段是本地单用户，不包含多用户、云同步、Marketplace、复杂向量数据库或大规模推荐算法平台。参见 [PRD §5](../docs/method-system-prd-v0.1.md#5-mvp-技术路线)、[§36](../docs/method-system-prd-v0.1.md#36-mvp-明确不做)。
- 当前工作区的 Skillbox 源码位于被 Git 忽略的 `docs/private-project/skillbox`，作为 Web、CRUD、Revision、Search、Recommend、Usage 的参考实现；本项目不 Fork Skillbox，具体代码移植与技术栈需逐项评估。参见 [PRD §5–§6](../docs/method-system-prd-v0.1.md#5-mvp-技术路线)。
- Web 采用 Card First，只提供 Concept CRUD 与 Dashboard，不提供 Recommendation Playground 或生成 Prompt。Concept Card 展示标题、描述、WebP 配图与标签；两个类型字段可留空，只有已填写的类型才展示。Relation 支持 `related_to`、`often_used_with`、`contrasts_with`、`extends`、`part_of`，与暂缓的 Recipe 分离。参见 [PRD §8–§9](../docs/method-system-prd-v0.1.md#8-web-产品原则)、[§14](../docs/method-system-prd-v0.1.md#14-concept-relation)、[§27](../docs/method-system-prd-v0.1.md#27-web-页面)。
- Web 只保留一个 Concept 管理视图，合并当前语言的浏览、搜索、筛选、详情、创建、编辑、归档/恢复、受保护删除和修订；Dashboard 独立显示目录与使用统计。2026-09-25 最终验收反馈后写入，具体行为见 [P1 CRUD 规格](concept-schema-crud-dashboard.md)。
- MVP 主线为 Concept CRUD → Recommendation API / Eval Harness → Relation → Skill → Feedback / Eval；Schema 与技术选型是各阶段的前置工作。参见 [PRD §34](../docs/method-system-prd-v0.1.md#34-mvp-实施顺序)。
- 目录允许收录普通专业术语；某语言有名称、描述和出处文本即可浏览，补齐触发场景和 Agent Instruction 后进入该语言推荐池，不要求配图、另一语言或两个类型字段齐备。每语言支持多张独立图片和逐张移除；无图时显示默认配图。Web、搜索、推荐、Apply 不混用另一语言的文案或上传图片。参见 [PRD §12](../docs/method-system-prd-v0.1.md#12-concept-数据模型)、[§20](../docs/method-system-prd-v0.1.md#20-搜索与推荐)。
- 每种语言有纯文本 `source_text`；该语言进入可浏览目录前要求非空，只检查非空，不联网核验出处。`wiki_url` 是可选的延伸阅读链接，缺失时隐藏入口，不跨语言回退。参见 [PRD §12](../docs/method-system-prd-v0.1.md#12-concept-数据模型)、[§27](../docs/method-system-prd-v0.1.md#27-web-页面)。
- Skill 仅在明确命令或直接自然语言请求下运行；本地模型优先，远端模型在首次发送上下文前明确告知并由用户选择。没有可用模型时提示配置或选择，不伪造空推荐。参见 [PRD §24](../docs/method-system-prd-v0.1.md#24-推荐流程)、[§29](../docs/method-system-prd-v0.1.md#29-skill)。

## P1 可实施规格

[Concept Schema、CRUD 与 Dashboard 实施规格](concept-schema-crud-dashboard.md) 明确了跨语言和各语言字段、派生的浏览/推荐资格、归档生命周期、Revision、Card First Web 与 Dashboard 的真实数据口径。该规格由 [P1 实施任务](../tasks/0022-implement-concept-schema-crud-dashboard.md) 承接，已在独立 `codex/concept-mvp-demo` 工作区按 0023–0029 完成；应用栈与存储见 [ADR 0002](../docs/adr/0002-local-product-stack.md)。推荐接口与离线评测见 0032–0034；Relation 的存储和展示见 [关系契约](concept-relations.md)，推荐排序留给 0036。

## 命名与版本

- [PRD](../docs/method-system-prd-v0.1.md) 已将产品命名为 **Concept Discovery**，并把推荐实体命名为 **Concept**。当前文档为 v0.6（访谈确认的收录、双语推荐、Web/Skill 与模型边界）；重写前的 v0.1 章节结构不再被引用。
- 仓库文件路径仍保留 `docs/method-system-prd-v0.1.md`、`docs/method-registry-curated-v0.1.md`；清洗稿正文沿用 “Core Method”。文件重命名属后续决策，需要 ADR 并同步 `project.json` 与本文件引用。
- 本文件以下统一使用 Concept；引用旧材料原文时保留其 “Method” 用词。

## 当前实现边界

独立 `codex/concept-mvp-demo` 工作区已实现可运行的 P1 Registry、Web CRUD 与 Dashboard，以及 0032–0034 的推荐接口、模型配置和开发用离线评测、0035–0036 的 Relation CRUD、详情展示与互补同分排序、0037 的 [Prompt Composer](prompt-composer.md) 模块、0038 的 [Concept Discovery Skill](../skills/concept-discovery/SKILL.md)、0039 的 [真实 Usage/Feedback](skill-usage.md)；运行时和可执行命令分别见 [运行时](../docs/agent-environment/runtime.md)、[命令契约](../docs/agent-environment/commands.md)。2026-09-26 用户确认个人试用版可用；[0040 正式质量 Gate](../tasks/0040-mvp-eval-acceptance.md)仍待真实任务自然积累与人工复核。PRD 中的 `concept-discovery start`、目录树、JSON / YAML 和 UI 示例均为设计输入，不是当前可用接口。自动化与浏览器检查通过本身不证明正式质量 Gate 通过。

## 待定契约：材料冲突与字段缺口

| 待定项 | 材料依据 | 后续必须产出的决定 |
| --- | --- | --- |
| 目录收录与推荐资格 | [PRD §1、§12](../docs/method-system-prd-v0.1.md#1-产品定义)允许有名称和出处的专业术语进入目录，但某语言须有推荐内容才进入该语言推荐池；[清洗稿 §2](../docs/method-registry-curated-v0.1.md#2-准入标准)的 Core 条件更窄 | 已定稿：出处用纯文本录入，只检查是否非空，不把外部核验作为导入前置；Schema 任务实现各语言推荐条件，清洗稿分类不自动等于推荐资格 |
| 类型字段范围 | [PRD §12、§13](../docs/method-system-prd-v0.1.md#12-concept-数据模型)使用 `interaction_type` + `epistemic_type`，现有枚举只覆盖方法论相关类别；[清洗稿 §3、§7](../docs/method-registry-curated-v0.1.md#7-skill-推荐时的最小卡片)使用旧 `type` | 已定稿：两个字段独立可空，已填写时需符合枚举；目录收录、卡片展示和推荐资格都不强迫普通术语选择近似类型。旧 `type` 的导入映射留待 Schema 任务 |
| 关联字段名 | [PRD §14](../docs/method-system-prd-v0.1.md#14-concept-relation)定为独立关系表 `concept_relations`，不使用卡片内嵌字段；[清洗稿 §6 P1](../docs/method-registry-curated-v0.1.md#6-后续补充优先级)建议 `related_methods` | PRD 侧已定稿独立关系表（含方向语义，见 §17）；清洗稿 `related_methods` 的导入映射仍待定 |
| 空推荐表示 | [PRD §22](../docs/method-system-prd-v0.1.md#22-recommendation-输出)已定 `recommendations: []` 为机器表示、`NONE` 仅作标签；[清洗稿 §8](../docs/method-registry-curated-v0.1.md#8-推荐策略建议)仍写 `none` | 已定稿：以 PRD §22 为准；待更新清洗稿 §8 的 `none` 写法并补可校验样例 |
| `status`、包归属 | [PRD §12](../docs/method-system-prd-v0.1.md#12-concept-数据模型)示例 `status: core`，未定义 pack；[清洗稿 §1、§4、§5](../docs/method-registry-curated-v0.1.md#1-清洗结论)组织为 Core、Candidate Packs、Archive | [P1 规格](concept-schema-crud-dashboard.md) 已将生命周期定为 `active` / `archived`，浏览/推荐资格按语言派生；`core` 不作状态。旧 Core/Pack 分类及迁移映射留待后续。 |
| 模型字段缺口 | [PRD §27](../docs/method-system-prd-v0.1.md#27-web-页面)要求按 Tag 筛选、[§23](../docs/method-system-prd-v0.1.md#23-推荐规则)要求 Why Now；[PRD §12](../docs/method-system-prd-v0.1.md#12-concept-数据模型)已含 `locales.cn.tags` / `locales.en.tags`，[§22](../docs/method-system-prd-v0.1.md#22-recommendation-输出)已注明 `reason` 即 Why Now | 已定稿方向：`tags` 是每种语言各自的自由标签，`domains` / `intents` 是跨语言共用受控值；`reason` 即 Why Now。Schema 落地时以 PRD §12、§22 为准并加校验 |
| 按语言发布与迁移 | [PRD §12](../docs/method-system-prd-v0.1.md#12-concept-数据模型)使用 `locales.cn` / `locales.en`；清洗稿主体为中文 | [P1 规格](concept-schema-crud-dashboard.md) 已定稿各语言可浏览/可推荐校验及无跨语言回退；旧平铺字段迁移仍待具体导入任务决定。 |
| Recipe | [PRD §19](../docs/method-system-prd-v0.1.md#19-recipe)定义 Recipe 并明确 MVP 暂缓；[§27](../docs/method-system-prd-v0.1.md#27-web-页面)未排 Recipes 页；[§12](../docs/method-system-prd-v0.1.md#12-concept-数据模型)无 Recipe Schema | 未来单独定义 Recipe 结构、接口与推荐池关系；MVP 的 Relation 不依赖 Recipe |

`instruction` 与 `agent_instruction` 的字段名分歧已解除：[PRD §12](../docs/method-system-prd-v0.1.md#12-concept-数据模型) 与 [清洗稿 §3、§7](../docs/method-registry-curated-v0.1.md#7-skill-推荐时的最小卡片) 均使用 `agent_instruction`。

已确认的 P1 决策以实施规格为准；待定迁移与后续阶段仍须记录决定，不按某份示例默默定稿。

## 方法来源与准入状态

[清洗稿 §3](../docs/method-registry-curated-v0.1.md#3-core-methods)列出的 30 个 Core 是目录导入候选，不因旧稿分类自动具备推荐资格。MVP 可先录入名称和出处文本；每种语言的推荐资格取决于该语言内容是否齐备。30 个双语均可推荐的 Concept 是扩大范围前的证据目标，不阻止单语言的早期使用。

清洗稿称来源是 `daily-knowledge(1).md`，该原始文件未提供，无法核验其原文、完整性或逐条出处。清洗稿已说明 Trigger / Transform / Instruction 是结构化转译，不能作为原文直接引述。MVP 对用户录入的 `source_text` 只检查非空，不自动验证真假。

2026-09-25 接续的 80 条双语知识清单采用保留原分类值的导入决定：在现有受控词表上显式增加 6 种 `epistemic_type`、48 种 `domains` 和 24 种 `intents`，服务端与 Web 共用[词表及双语标签](../shared/taxonomy.json)，未知代码仍拒绝。明确的占位出处按语言清空，使该语言保留为草稿；其余出处仍未经过外部真实性核验。知识清单与人工标注 Eval 是两种独立输入。

[清洗稿 §6 P0](../docs/method-registry-curated-v0.1.md#6-后续补充优先级)把第一性原理、逆向思维、第二层思维、事件—局势—结构、安全边际、古德哈特定律列为优先补定义与来源的六项。MVP 允许先以目录草稿记录缺口；进入某语言推荐池前填写非空出处文本及该语言必需内容。不编造引用。

## 未来产品验收入口

以下是 [PRD §35](../docs/method-system-prd-v0.1.md#35-mvp-gate) MVP Gate 之后的产品能力验收方向，本次环境初始化不执行这些验收：

| 能力 | 必须能观察到的结果 |
| --- | --- |
| Registry + Web | 一条命令启动本地服务；Web 只提供 Concept CRUD 与 Dashboard，浏览器可切换 `cn` / `en`；卡片、搜索、编辑、WebP 图片和可选 Wiki 链接按语言对应，可查看修订与各语言推荐资格 |
| Diagnose + Recommend | 用户主动调用 Skill；推荐接口按显式 `locale` 输出同语言诊断与最多 3 个推荐，无明显增益时返回空推荐；无可用模型时提示配置或选择 |
| Compose + 应用 | 在 Skill 中由用户选择 Concept，Agent 执行同语言上下文化 Prompt 后才算应用；Web 不生成或展示该 Prompt |
| 反馈 | Dashboard 展示真实 Skill 使用的推荐、应用、忽略等统计；开发用评测数据与真实使用分开 |

实现顺序、依赖和有限任务见 [后续任务](../tasks/backlog.md)。Eval 的数值通过门槛仍未定（已列入 [PRD §40](../docs/method-system-prd-v0.1.md#40-未决问题)），判定协议方向见 [PRD §32](../docs/method-system-prd-v0.1.md#32-eval)。
