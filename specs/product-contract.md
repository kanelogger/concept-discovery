# 产品方向与待定契约

状态：产品方向索引；产品契约尚未定稿。此文件从两份产品输入提取边界，不将 Draft 示例提升为已实现能力。

## 已确认的产品方向

- 为人与 Agent 的对话发现当前缺失的思维工具，解释推荐原因，并生成上下文化 Prompt。参见 [PRD §2、§3](../docs/method-system-prd-v0.1.md#2-产品定位)。
- 产品由本地 Concept System（Registry + 推荐引擎）和薄的 Concept Discovery Skill 组成；Registry 是 Web、Skill 与 CLI 共享的唯一事实源。参见 [PRD §3.7](../docs/method-system-prd-v0.1.md#37-system-是唯一事实源)、[§7](../docs/method-system-prd-v0.1.md#7-产品组成)、[§8](../docs/method-system-prd-v0.1.md#8-总体架构)。
- Diagnose → Recommend → 用户选择 → Compose → 应用是目标流程。默认推荐 1 个、最多 3 个，允许空推荐，用户保留应用决定权。参见 [PRD §13.2](../docs/method-system-prd-v0.1.md#132-recommend)、[§14](../docs/method-system-prd-v0.1.md#14-推荐流程)、[§15](../docs/method-system-prd-v0.1.md#15-推荐规则)、[§17](../docs/method-system-prd-v0.1.md#17-prompt-composer)。
- 第一阶段是本地单用户，不包含多用户、云同步、Marketplace、复杂向量数据库或大规模推荐算法平台。参见 [PRD §5](../docs/method-system-prd-v0.1.md#5-非目标)、[§25](../docs/method-system-prd-v0.1.md#25-mvp-技术建议)。

## 命名与版本

- [PRD](../docs/method-system-prd-v0.1.md) v0.1 已将产品命名为 **Concept Discovery**，并把推荐实体命名为 **Concept**。
- 仓库文件路径仍保留 `docs/method-system-prd-v0.1.md`、`docs/method-registry-curated-v0.1.md`；清洗稿正文沿用 “Core Method”。文件重命名属后续决策，需要 ADR 并同步 `project.json` 与本文件引用。
- 本文件以下统一使用 Concept；引用旧材料原文时保留其 “Method” 用词。

## 当前实现边界

当前仓库初始化交付人和 Agent 协作所需的导航、任务流程、运行时约束与检查入口。运行时和可执行命令分别见 [运行时](../docs/agent-environment/runtime.md)、[命令契约](../docs/agent-environment/commands.md)。

应用框架、产品服务、Concept Schema、正式 Registry、Web UI、推荐与 Compose 业务 Skills 均未实现。PRD 中的 `concept-discovery start`、目录树、JSON / YAML 和 UI 示例均为设计输入，不是当前可用接口。协作环境检查通过不代表产品验收通过。

## 待定契约：材料冲突与字段缺口

| 待定项 | 材料依据 | 后续必须产出的决定 |
| --- | --- | --- |
| Core 准入门槛 | [PRD §23](../docs/method-system-prd-v0.1.md#23-concept-registry-初始规模)只列优先覆盖范围，未复述准入条件；[清洗稿 §2](../docs/method-registry-curated-v0.1.md#2-准入标准)允许满足大部分条件 | 统一准入条件、例外处理和逐条审核记录；不能直接把清洗稿 30 项当作正式 Core |
| 类型字段名 | [PRD §9、§10](../docs/method-system-prd-v0.1.md#9-核心数据模型)使用 `interaction_type`；[清洗稿 §3、§7](../docs/method-registry-curated-v0.1.md#7-skill-推荐时的最小卡片)使用 `type` | 确定唯一规范字段及导入时的兼容或拒绝策略 |
| 关联字段名 | [PRD §9](../docs/method-system-prd-v0.1.md#9-核心数据模型)使用 `related`；[清洗稿 §6 P1](../docs/method-registry-curated-v0.1.md#6-后续补充优先级)建议 `related_methods` | 确定唯一字段名、关联 ID 校验和缺失引用处理 |
| 空推荐表示 | [PRD §13.2](../docs/method-system-prd-v0.1.md#132-recommend)已定 `recommendations: []` 为机器表示、`NONE` 仅作标签；[清洗稿 §8](../docs/method-registry-curated-v0.1.md#8-推荐策略建议)仍写 `none` | 以 PRD 约定为准，补可校验样例并更新材料 |
| `status`、包归属 | [PRD §9](../docs/method-system-prd-v0.1.md#9-核心数据模型)示例 `status: core`，未定义 pack；[清洗稿 §1、§4、§5](../docs/method-registry-curated-v0.1.md#1-清洗结论)组织为 Core、Candidate Packs、Archive | 明确生命周期状态、包归属是否独立，以及默认推荐池过滤规则 |
| 模型字段缺口 | [PRD §24](../docs/method-system-prd-v0.1.md#24-web-页面)要求按 Tag 筛选、[§15](../docs/method-system-prd-v0.1.md#15-推荐规则)要求 Why Now；[PRD §9](../docs/method-system-prd-v0.1.md#9-核心数据模型)的模型含 `tags`，输出仅有 `reason` | 明确 `tags` 语义、`reason` 即 Why Now，并同步 Schema 与校验 |
| Recipe | [PRD §12](../docs/method-system-prd-v0.1.md#12-recipe)定义 Recipe，[§24](../docs/method-system-prd-v0.1.md#24-web-页面)有 Recipes 页；[§9](../docs/method-system-prd-v0.1.md#9-核心数据模型)无 Recipe Schema，[§18](../docs/method-system-prd-v0.1.md#18-api-cli)无 Recipe 端点 | 定义 Recipe 结构、接口与推荐池关系；区分 v1 CRUD 与后续自动推荐 |

`instruction` 与 `agent_instruction` 的字段名分歧已解除：[PRD §9](../docs/method-system-prd-v0.1.md#9-核心数据模型) 与 [清洗稿 §3、§7](../docs/method-registry-curated-v0.1.md#7-skill-推荐时的最小卡片) 均使用 `agent_instruction`。

决策应写入规格与 ADR，再由样例及校验约束执行；在此之前不生成正式 Registry，也不按某份示例默默定稿。

## 方法来源与准入状态

[清洗稿 §3](../docs/method-registry-curated-v0.1.md#3-core-methods)列出的 30 个 Core 是清洗结果，全部仍待正式准入审查。[PRD §23](../docs/method-system-prd-v0.1.md#23-concept-registry-初始规模)要求最终名单单独审核，数量目标不能替代质量验收。

清洗稿称来源是 `daily-knowledge(1).md`，该原始文件未提供，无法核验其原文、完整性或逐条出处。清洗稿已说明 Trigger / Transform / Instruction 是结构化转译，不能作为原文直接引述。

[清洗稿 §6 P0](../docs/method-registry-curated-v0.1.md#6-后续补充优先级)要求优先补正式定义与来源的六项为：第一性原理、逆向思维、第二层思维、事件—局势—结构、安全边际、古德哈特定律。最后一项有简述，仍需补完整条目。后续任务必须记录可核验来源与使用范围；资料不足时保留待补状态，不编造引用。

## 未来产品验收入口

以下是 [PRD §28](../docs/method-system-prd-v0.1.md#28-v1-验收标准)的后续验收方向，本次环境初始化不执行这些验收：

| 能力 | 必须能观察到的结果 |
| --- | --- |
| Registry + Web | 一条命令启动本地服务；浏览器可查看、增删改、搜索 Concept、导入 Markdown、查看 Dashboard；Skill 可读取同一份有效数据 |
| Diagnose + Recommend | 输入任务及可选上下文 / 回答，输出诊断与最多 3 个推荐；每项提供理由及置信度；无明显增益时返回 `recommendations: []` |
| Compose + 应用 | 根据选择的 Concept 与当前上下文生成完整 Prompt；用户能理解推荐并选择应用，Agent 可按生成的 Prompt 执行 |
| 反馈 | 按定稿的数据语义记录采用、忽略等反馈，并可核对 Dashboard 统计与记录一致性 |

实现顺序、依赖和有限任务见 [后续任务](../tasks/backlog.md)。Eval 的数值通过门槛、场景来源与判定方式仍未定，见 [PRD §31.2](../docs/method-system-prd-v0.1.md#312-未决问题)。
