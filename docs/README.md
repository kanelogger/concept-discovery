# 文档导航

本仓库当前交付协作开发环境。产品材料描述未来方向，产品功能尚未实现。

## 原始产品输入

以下两份材料保留原稿，阅读时不要把示例接口、清洗分类或规划当作运行事实。

| 材料 | 状态与用途 |
| --- | --- |
| [Concept Discovery PRD](method-system-prd-v0.1.md) | v0.1 Draft；产品目标、场景、建议 Schema、MVP 范围与未来验收标准 |
| [Concept Registry 清洗稿](method-registry-curated-v0.1.md) | v0.1 清洗输入；30 个 Core 清洗项、Candidate Packs、Archive 与补充优先级；正式准入尚未完成 |

PRD v0.1 已将产品命名为 Concept Discovery；文件路径仍为 `method-*`，命名迁移见 [产品方向与待定契约](../specs/product-contract.md)。

清洗稿引用的 `daily-knowledge(1).md` 未提供；其中六项 P0 仍需补正式定义与来源。字段和准入规则的材料差异统一记录在 [产品方向与待定契约](../specs/product-contract.md)，不要在引用时自行消除差异。

## 已实现协作环境

| 入口 | 回答的问题 |
| --- | --- |
| [项目首页](../README.md) | 如何进入仓库并完成首次检查？ |
| [命令契约](agent-environment/commands.md) | 有哪些真实可执行命令，它们检查什么？ |
| [运行时](agent-environment/runtime.md) | 本地与 CI 依赖什么运行环境？ |
| [本地与 CI 一致性](agent-environment/ci-parity.md) | 如何复现自动检查，如何理解覆盖边界？ |
| [协作流程](../workflow/README.md) | 人和 Agent 如何准备、执行、验证与交接任务？ |
| [任务模板](../workflow/task-template.md) | 新任务如何记录范围、验收和证据？ |
| [协作环境初始化决策](adr/0001-collaboration-bootstrap.md) | 本次环境初始化为何采用这些边界？ |
| [初始化任务记录](../tasks/0001-bootstrap.md) | 本次做了什么，验证证据在哪里？ |

## 未来产品契约与任务

- [产品方向与待定契约](../specs/product-contract.md)：产品事实索引、尚未实现的能力、材料冲突与来源缺口。
- [后续产品任务](../tasks/backlog.md)：从 Schema、来源与准入，到 Registry + Web，再到 Recommend、Compose 和反馈的任务顺序与验收。

后续实现应先定稿受影响的契约，再把可执行接口、验证结果和必要决策同步到仓库。环境检查成功只证明当前协作环境满足其检查项。
