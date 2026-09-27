# 产品与实现入口

更新：2026-09-27。产品方向统一为认知自动补全，第一阶段建设 Web 知识库；本文件只导航，不另写一套需求。

## 当前产品文档

- [需求文档](../docs/需求文档.md)：产品定位、用户、阶段范围、内容质量和验收。
- [产品设计文档](../docs/产品设计文档.md)：交互、数据映射、搜索、关系及当前实现差距。

## 技术规格

以下文件保留既有实现的字段、接口和验证边界。旧 P1–P5 阶段编号属于历史路线；第一阶段新设计尚未实施，改造时同步受影响规格，不把目标当作已实现行为。

| 主题 | 技术依据 |
| --- | --- |
| Registry、双语、CRUD、修订、Dashboard | [数据与 CRUD](concept-schema-crud-dashboard.md) |
| 概念关系 | [Relation](concept-relations.md) |
| 既有推荐与评测 | [推荐接口](recommendation-contract.md)、[离线评测](eval-harness.md) |
| 既有 Agent 应用 | [Composer](prompt-composer.md)、[Skill](../skills/concept-discovery/SKILL.md)、[Usage](skill-usage.md) |
| 实现栈与命令 | [存储决策](../docs/adr/0002-local-product-stack.md)、[命令说明](../docs/agent-environment/commands.md) |

当前进度见[任务状态](../workflow-state.json)与[待办](../tasks/backlog.md)。旧材料的替代与恢复方式见[文档收敛决策](../docs/adr/0004-product-doc-consolidation.md)。本次未运行产品功能验收；既有推荐质量 Gate 未完成。
