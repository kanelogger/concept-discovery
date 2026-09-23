# 产品方向与待定契约

状态：产品方向索引；产品契约尚未定稿。此文件从两份产品输入提取边界，不将 Draft 示例提升为已实现能力。

## 已确认的产品方向

- 为人与 Agent 的对话发现当前缺失的思维工具，解释推荐原因，并生成上下文化 Prompt。参见 [PRD §1、§3](../docs/method-system-prd-v0.1.md#1-产品定义)。
- 产品由本地 Concept System（Registry + 推荐引擎）和薄的 Concept Discovery Skill 组成；Registry 是 Web、Skill 与后续 CLI 共享的唯一事实源。参见 [PRD §7](../docs/method-system-prd-v0.1.md#7-产品组成)、[§38](../docs/method-system-prd-v0.1.md#38-最终产品结构)。
- Diagnose → Recommend → 用户选择 → Compose → 应用是目标流程。默认推荐 1 个、最多 3 个，允许空推荐，用户保留应用决定权。参见 [PRD §22](../docs/method-system-prd-v0.1.md#22-recommendation-输出)、[§23](../docs/method-system-prd-v0.1.md#23-推荐规则)、[§24](../docs/method-system-prd-v0.1.md#24-推荐流程)、[§26](../docs/method-system-prd-v0.1.md#26-prompt-composer)。
- 第一阶段是本地单用户，不包含多用户、云同步、Marketplace、复杂向量数据库或大规模推荐算法平台。参见 [PRD §5](../docs/method-system-prd-v0.1.md#5-mvp-技术路线)、[§36](../docs/method-system-prd-v0.1.md#36-mvp-明确不做)。

## 命名与版本

- [PRD](../docs/method-system-prd-v0.1.md) 已将产品命名为 **Concept Discovery**，并把推荐实体命名为 **Concept**。当前文档为 v0.2（MVP 范围收敛与一致性修复），重写前的 v0.1 章节结构不再被引用。
- 仓库文件路径仍保留 `docs/method-system-prd-v0.1.md`、`docs/method-registry-curated-v0.1.md`；清洗稿正文沿用 “Core Method”。文件重命名属后续决策，需要 ADR 并同步 `project.json` 与本文件引用。
- 本文件以下统一使用 Concept；引用旧材料原文时保留其 “Method” 用词。

## 当前实现边界

当前仓库初始化交付人和 Agent 协作所需的导航、任务流程、运行时约束与检查入口。运行时和可执行命令分别见 [运行时](../docs/agent-environment/runtime.md)、[命令契约](../docs/agent-environment/commands.md)。

应用框架、产品服务、Concept Schema、正式 Registry、Web UI、推荐与 Compose 业务 Skills 均未实现。PRD 中的 `concept-discovery start`、目录树、JSON / YAML 和 UI 示例均为设计输入，不是当前可用接口。协作环境检查通过不代表产品验收通过。

## 待定契约：材料冲突与字段缺口

| 待定项 | 材料依据 | 后续必须产出的决定 |
| --- | --- | --- |
| Core 准入门槛 | [PRD §33](../docs/method-system-prd-v0.1.md#33-初始-concept-数量)只列优先覆盖范围，未复述准入条件；[清洗稿 §2](../docs/method-registry-curated-v0.1.md#2-准入标准)允许满足大部分条件 | 统一准入条件、例外处理和逐条审核记录；不能直接把清洗稿 30 项当作正式 Core（PRD v0.2 §33、§34 P1 已加入准入审查前置） |
| 类型字段名 | [PRD §12、§13](../docs/method-system-prd-v0.1.md#12-concept-数据模型)使用 `interaction_type` + `epistemic_type` 双字段并给出枚举定义；[清洗稿 §3、§7](../docs/method-registry-curated-v0.1.md#7-skill-推荐时的最小卡片)使用 `type` | PRD 侧已定稿双字段；清洗稿 `type` 到双字段的导入映射仍待定，由后续 Schema 任务决定 |
| 关联字段名 | [PRD §14](../docs/method-system-prd-v0.1.md#14-concept-relation)定为独立关系表 `concept_relations`，不使用卡片内嵌字段；[清洗稿 §6 P1](../docs/method-registry-curated-v0.1.md#6-后续补充优先级)建议 `related_methods` | PRD 侧已定稿独立关系表（含方向语义，见 §17）；清洗稿 `related_methods` 的导入映射仍待定 |
| 空推荐表示 | [PRD §22](../docs/method-system-prd-v0.1.md#22-recommendation-输出)已定 `recommendations: []` 为机器表示、`NONE` 仅作标签；[清洗稿 §8](../docs/method-registry-curated-v0.1.md#8-推荐策略建议)仍写 `none` | 已定稿：以 PRD v0.2 §22 为准；待更新清洗稿 §8 的 `none` 写法并补可校验样例 |
| `status`、包归属 | [PRD §12](../docs/method-system-prd-v0.1.md#12-concept-数据模型)示例 `status: core`，未定义 pack；[清洗稿 §1、§4、§5](../docs/method-registry-curated-v0.1.md#1-清洗结论)组织为 Core、Candidate Packs、Archive | 明确生命周期状态、包归属是否独立，以及默认推荐池过滤规则；v0.2 仍只示例 `status: core`，未定义 pack |
| 模型字段缺口 | [PRD §27](../docs/method-system-prd-v0.1.md#27-web-页面)要求按 Tag 筛选、[§23](../docs/method-system-prd-v0.1.md#23-推荐规则)要求 Why Now；[PRD §12](../docs/method-system-prd-v0.1.md#12-concept-数据模型)已含 `tags`，[§22](../docs/method-system-prd-v0.1.md#22-recommendation-输出)已注明 `reason` 即 Why Now | 已定稿方向：`tags` 为自由标签，与 `domains` / `intents` 并列；`reason` 即 Why Now。Schema 落地时以 PRD v0.2 §12、§22 为准并加校验 |
| Recipe | [PRD §19](../docs/method-system-prd-v0.1.md#19-recipe)定义 Recipe 并明确 MVP 暂缓；[§27](../docs/method-system-prd-v0.1.md#27-web-页面)未排 Recipes 页；[§12](../docs/method-system-prd-v0.1.md#12-concept-数据模型)无 Recipe Schema，v0.2 无 Recipe 接口章节 | 定义 Recipe 结构、接口与推荐池关系；区分 v1 CRUD 与后续自动推荐（已列入 PRD §40 未决问题） |

`instruction` 与 `agent_instruction` 的字段名分歧已解除：[PRD §12](../docs/method-system-prd-v0.1.md#12-concept-数据模型) 与 [清洗稿 §3、§7](../docs/method-registry-curated-v0.1.md#7-skill-推荐时的最小卡片) 均使用 `agent_instruction`。

决策应写入规格与 ADR，再由样例及校验约束执行；在此之前不生成正式 Registry，也不按某份示例默默定稿。

## 方法来源与准入状态

[清洗稿 §3](../docs/method-registry-curated-v0.1.md#3-core-methods)列出的 30 个 Core 是清洗结果，全部仍待正式准入审查。[PRD §33](../docs/method-system-prd-v0.1.md#33-初始-concept-数量)要求最终名单单独审核，数量目标不能替代质量验收；v0.2 已明确名单全部通过准入审查后方可导入。

清洗稿称来源是 `daily-knowledge(1).md`，该原始文件未提供，无法核验其原文、完整性或逐条出处。清洗稿已说明 Trigger / Transform / Instruction 是结构化转译，不能作为原文直接引述。

[清洗稿 §6 P0](../docs/method-registry-curated-v0.1.md#6-后续补充优先级)要求优先补正式定义与来源的六项为：第一性原理、逆向思维、第二层思维、事件—局势—结构、安全边际、古德哈特定律。最后一项有简述，仍需补完整条目。后续任务必须记录可核验来源与使用范围；资料不足时保留待补状态，不编造引用。

## 未来产品验收入口

以下是 [PRD §35](../docs/method-system-prd-v0.1.md#35-mvp-gate) MVP Gate 之后的产品能力验收方向，本次环境初始化不执行这些验收：

| 能力 | 必须能观察到的结果 |
| --- | --- |
| Registry + Web | 一条命令启动本地服务；浏览器可查看、增删改、搜索 Concept、导入 Markdown、查看 Dashboard；Skill 可读取同一份有效数据 |
| Diagnose + Recommend | 输入任务及可选上下文 / 回答，输出诊断与最多 3 个推荐；每项提供理由及置信度；无明显增益时返回 `recommendations: []` |
| Compose + 应用 | 根据选择的 Concept 与当前上下文生成完整 Prompt；用户能理解推荐并选择应用，Agent 可按生成的 Prompt 执行 |
| 反馈 | 按定稿的数据语义记录采用、忽略等反馈，并可核对 Dashboard 统计与记录一致性 |

实现顺序、依赖和有限任务见 [后续任务](../tasks/backlog.md)。Eval 的数值通过门槛仍未定（已列入 [PRD §40](../docs/method-system-prd-v0.1.md#40-未决问题)），判定协议方向见 [PRD §32](../docs/method-system-prd-v0.1.md#32-eval)。
