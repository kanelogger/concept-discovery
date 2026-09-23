# 复用计划

## 需求摘要

为人与 Agent 的对话识别当前可能缺少的思维方法，给出方法推荐理由，并按用户选择生成上下文化 Prompt。目标由本地 Method Registry 与可供 Agent 调用的 Skills 组成；当前仓库尚无应用实现。依据 [产品契约](../specs/product-contract.md)、[PRD](../docs/method-system-prd-v0.1.md) 和 [产品待办](../tasks/backlog.md)。

## 目标框架

Node.js / TypeScript（用户已确认）。自托管要求、大型单体接受度仍待确认；当前仅采用架构参考，不借用代码，GPL/AGPL 接受度不影响本次决策。

## 候选清单（手动相关度排序；脚本评分不可用）

| 排名 | 仓库 | 分值 | 简述 |
| --- | --- | --- | --- |
| 1 | [tjboudreaux/cc-thinking-skills](https://github.com/tjboudreaux/cc-thinking-skills) | 手动筛选，未生成数值分 | 28 个 Agent Skills，含思维方法 Router、方法组合、评估与审计目录；MIT；GitHub 页面显示约 1.3k stars。最接近“按问题路由到方法”的 Agent 侧能力。 |
| 2 | [kcchien/model-thinking](https://github.com/kcchien/model-thinking) | 手动筛选，未生成数值分 | 200+ mental models 的跨领域 Agent Skill；能按具体问题挑选 2–3 个模型、交叉分析；MIT；GitHub 页面显示 85 stars。与方法内容和推荐体验高度相近。 |
| 3 | [bigscience-workshop/promptsource](https://github.com/bigscience-workshop/promptsource) | 手动筛选，未生成数值分 | Apache-2.0 的 Prompt 创建、共享、模板化与浏览工具；可参考结构化内容管理和质量标准。面向 NLP 数据集提示模板，不做思维方法诊断或对话上下文推荐。 |

## 深入检查（top 3）

证据来源均为手动 GitHub 页面检查（README、顶层目录、许可及可见清单/入口）；`gh` 与 GitHub API / curl 在本环境无法连接，侦察脚本未能取得 API 数据，故不伪造脚本分值或仓库活跃度时间戳。

1. **tjboudreaux/cc-thinking-skills** — README 描述 28 个可移植 Agent Skills；Router 可返回 NONE、一个或最多三个 Skill，另有组合 Skill。顶层有 `skills/`、`evals/`、`analysis/`、`scripts/`、插件元数据和贡献文档；MIT。它把 Skill 内容、路由、评估拆开，适合参考模块边界。评估说明称路由当前为手动，且性能证据不足以作准确率承诺。没有 Web Registry、方法 CRUD、服务端推荐或 Compose UI。
2. **kcchien/model-thinking** — README 和目录显示单一 Skill 工作流加分主题的 `references/` 内容，含示例、评估及插件安装材料；MIT。README 声称 200+ 模型，按场景挑选 2–3 个并检查适用条件。可参考方法内容按需加载、推荐解释和边界表达；未发现独立的本地 Registry 管理应用，也没有用户逐项选择后生成 Prompt 的产品服务闭环。
3. **bigscience-workshop/promptsource** — README 描述 Web GUI、结构化 Jinja Prompt、浏览与 API；有 `promptsource/`、`test/`、`setup.py` 和文档；Apache-2.0。它可参考内容模板化、管理界面及质量标准，但数据模型围绕数据集样例和 NLP 任务提示，不包含思维方法本体、上下文诊断或面向 Agent 的推荐流程。它依赖旧版 Python 环境，且不适合作 Node.js/TypeScript 基座。

## 复用决策：reference

不 fork、不复制代码；在后续设计中参考候选 1 的路由 / 组合 / 评估分层，以及候选 3 的结构化资产与管理界面边界。

## 决策依据

- **领域匹配：中。** 两个思维 Skill 项目覆盖思维方法、问题到方法的路由和 Agent 指令；没有本产品的正式 Method Registry、诊断结果 / 用户应用状态、内容准入治理和可视化管理流程。全产品核心流程覆盖不足以直接复用。
- **架构契合：高（局部）。** Skill 目录、Router 与方法条目可分离；PromptSource 的模板化资产与界面也可独立借鉴。它们都没有提供可裁剪的完整产品基座。
- **可维护性 / 许可：** 候选 1 与 2 为 MIT，候选 3 为 Apache-2.0；仓库页面未标为 archived。手动来源未能稳定读取 `pushed_at`，故不据此断言活动度。候选 1 的 README 明示当前评估证据有限。
- **技术栈偏差：** 用户确认产品目标为 Node.js / TypeScript；方法 Skill 是 Markdown 资源，格式本身与语言无关。PromptSource 是 Python 应用，不作为代码基座。
- **规则匹配：** 满足“领域中高、局部架构清晰但不能直接复用整套实现”的 reference 条件。若未来要 fork，缺少覆盖 Web Registry、Schema/准入、上下文推荐和 Compose 的活跃宽松许可项目。

## 待确认项

- 是否必须自托管。
- 是否接受大型单体。
- 未来若要直接复用代码，是否接受 GPL/AGPL；本次只作架构参考，不涉及该选择。
- 自动化 GitHub 搜索、脚本评分、克隆与依赖清单完整性检查待 API/网络恢复后重跑。

## 借用单元清单

不适用（reference；不复制上游代码）。

## 迁移状态：不适用

## 迁移日志

- 2026-09-23：完成手动 GitHub 搜索与前三个候选的页面级架构检查。GitHub API 与 `gh`/`curl` 连接失败；依据网页搜索结果及仓库 README、目录和许可页面形成 reference 决策。`npm run validate` 通过；该检查不验证外部链接或搜索结果完整性。
