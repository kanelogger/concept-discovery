# concept-discovery

单人桌面知识卡网站。网页负责阅读和搜索，知识卡、附件和资料通过本地 `raw/` 维护。Agent 在明确要求时应用或维护知识。当前产品状态和事实入口见 [项目清单](project.json)，不要将草稿或待办当成已实现能力。

## 每次开始

- 先检查 `git status --short --branch`，保留已有及并发修改。
- 读 [执行环境声明](project.yml) 与[工作流](workflow/README.md)，再读 [当前任务状态](workflow-state.json)，有任务时读取对应文件；新任务按 [工作流](workflow/README.md) 建档。
- 需要角色分工或独立审阅时，读取[角色配置](agents.yml)，按[工作流](workflow/README.md#角色配置与调用)组合提示词并委派。
- 产品相关变更先读 [产品契约](specs/product-contract.md)，通过其中的来源链接按需加载原始材料。

## 工具与完成标准

- 环境问题运行 `npm run doctor`；仓库公共检查为 `npm run check`，详见 [命令说明](docs/agent-environment/commands.md)。
- 行为变更同步补充有回归价值的自动化测试，并实际执行。文档小改不编写镜像测试，执行相称检查即可。
- 按[独立审阅与问题闭环](workflow/README.md#独立审阅与问题闭环)安排高风险变更的方案、最终差异及修复审阅。
- 完成前更新任务中的证据、未决事项及下一步，同步 `workflow-state.json`；失败或未运行的检查必须写明。交接时按工作流将有证据、可复用的发现写回[经验库](LESSONS.md)。
- 验证并审查差异后，仅对本任务相关文件或代码块形成独立本地提交；遵循 [Git 规则](rules/git.md)。

## 上下文读取与维护

- 从本机上下文索引 `.agents/context/index.json` 选择本次所需 key；已知 key 批量精确读取，未知 key 先搜索 key、别名和摘要，再读当前段落或 JSON/YAML 字段。摘要仅定位，保留未覆盖项。
- 读取责任随工作流的 start、plan、implement、verify、handoff 节点执行。已读且来源未变的内容可以复用；来源、代码或任务假设变化时，只补读新增、过期或未覆盖的材料。Agent 主动执行，本项目没有客户端 hooks 保证自动调用。
- 仅在用户明确调用 `kane-agent-bootstrap` 时，从运行时可见技能入口定位工具，使用其 `context get/search/check/node/update`。普通任务或工具不可用时直接读取索引及其来源，照同一协议维护；不自动调用技能或阻塞工作。
- `project.yml` 声明环境并引用真实配置；`project.json` 保留产品状态入口；业务正文留在现有文档，本任务事实留在 `workflow-state.json` 明确指向的唯一任务文件。不另建全局任务状态或原文镜像。
- 先更新事实所属文件，再增量维护受影响索引，保留他人条目。交接前核对变化文件及本次已用 key；`sources` 过期时先重读当前来源、修正或重证结论，再更新摘要。重要决定在任务内记录理由、来源、反证条件及下一步。
- 索引在本机维护；索引缺失时，从工作流、命令说明和产品契约直接读取所需来源。`.agents/state/` 保存本机收据。`.agents/` 中仅 Harness 采用基线 `.agents/harness.json` 随项目提交。跨来源的新稳定结论仅在现有文档无合适归属时放入 `.agents/context/derived/` 并登记依赖。

## 按需读取

- 环境、服务与权限：[AI_ENVIRONMENT.md](AI_ENVIRONMENT.md)
- 测试与 CI：[验证规则](rules/testing.md)
- 密钥、私有上下文与外部写入：[安全边界](rules/security.md)

本文件只保留稳定入口。具体命令以 `package.json` 为准，领域差异留在产品契约，临时结论留在任务记录；不得把本次机器权限写成后续会话的授权。

## Agent skills

### Issue tracker

Track work in Markdown under `tasks/` and point to the active task in `workflow-state.json`. See `docs/agents/issue-tracker.md`.

### Triage labels

Use the default triage state names in task Markdown. See `docs/agents/triage-labels.md`.

### Domain docs

Read the active task and relevant product contract and ADRs before domain work. See `docs/agents/domain.md`.

### Concept Discovery

When the user explicitly invokes Concept Discovery or directly asks for applicable Concepts, read [the project Skill](skills/concept-discovery/SKILL.md). Ordinary tasks do not trigger recommendations.

<!-- kane-agent-harness:begin personal/personal -->
## 个人协作约定

默认用中文，先给结论或实际进展。按格赖斯合作原则控制信息量、据实表达、保持切题和条理清楚。参考 ASD-STE100 的清晰表达原则，使用短句、明确的指代和一致的术语。重要假设、错误前提、失败及未验证项应连同依据说明。

以用户目标、行为正确性和数据保护为先。范围和授权明确后，沿现有实现推进到验证与结果核对。缺少信息时先完成独立工作；只有正确性、产品方向或权限确实取决于用户决定时才询问，给出可审阅的结果、选项和影响。已有适用授权继续有效。

技术选择以需求、现行约束、维护成本及实测结果为依据，优先复用稳定方案。按风险分配工作量；实施任务沿用本项目编号，短任务可以简记。在多会话或多 Agent 协作前约定目标、输入、可写范围和验收。个人偏好仅随用户明确指示调整，有证据的工程发现写入所属规范。

### 跨会话接续

- 历史过长时用客户端的 `/compact` 或等价操作，保留原始目标、有效约束、决定、已验结果、未决事项与下一步；恢复前回读关键文件及最新输出。
- 交接时用 `/handoff` 或等价操作，给出任务来源、实际工作区、证据位置、当前授权与下一步。接手者重新核对工作区、资源、权限和验证输入。
- 探索备选方案可用 `/fork` 或等价操作，限定问题、可写范围与比较依据。分叉通常继承历史；独立判断显式使用全新上下文。客户端缺少相应操作时，可手工整理摘要、另开会话或在隔离副本比较。

按本次目的使用资料和工具。阶段、角色和历史记录不产生操作权限。凭据仅在获授权的位置使用，避免写进提示词、日志或交接。预期行为、当前实现与实测结果分别回到规格、源码和检查证据核实。新增或不一致的命令、服务和前置条件先对照真实配置，再修订环境清单。发现规则冲突时核对来源、适用范围与有效要求；仍影响执行时说明具体冲突。调整采用范围或路径后复查入口和引用。
<!-- kane-agent-harness:end personal/personal -->

<!-- kane-agent-harness:begin navigation -->
## 协作规范导航

- 工程标准 — [docs/code-standards.md](<docs/code-standards.md>)
- 项目环境清单 — [project.yml](<project.yml>)
- 本地文件忽略规则 — [.gitignore](<.gitignore>)
- 独立审阅 — [workflow/README.md](<workflow/README.md>)
- 外部服务与数据集成 — [docs/integrating.md](<docs/integrating.md>)
- 通用经验与项目复盘 — [LESSONS.md](<LESSONS.md>)
- 个人协作约定 — [AGENTS.md](<AGENTS.md>)
- 项目 README — [README.md](<README.md>)
- 需求与规格 — [specs/product-contract.md](<specs/product-contract.md>)
- 测试与验证 — [rules/testing.md](<rules/testing.md>)
- 任务工作流程 — [workflow/README.md](<workflow/README.md>)
<!-- kane-agent-harness:end navigation -->
