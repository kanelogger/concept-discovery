# concept-discovery

单人桌面知识卡网站；网页负责阅读、搜索和整理，Agent在明确要求时应用或维护知识。当前产品状态和事实入口见 [项目清单](project.json)，不要将草稿或待办当成已实现能力。

## 每次开始

- 先检查 `git status --short --branch`，保留已有及并发修改。
- 读 [执行环境声明](project.yml) 与[工作流](workflow/README.md)，再读 [当前任务状态](workflow-state.json)，有任务时读取对应文件；新任务按 [工作流](workflow/README.md) 建档。
- 产品相关变更先读 [产品契约](specs/product-contract.md)，通过其中的来源链接按需加载原始材料。

## 工具与完成标准

- 环境问题运行 `npm run doctor`；仓库公共检查为 `npm run check`，详见 [命令说明](docs/agent-environment/commands.md)。
- 行为变更同步补充有回归价值的自动化测试，并实际执行。文档小改不编写镜像测试，执行相称检查即可。
- 完成前更新任务中的证据、未决事项及下一步，同步 `workflow-state.json`；失败或未运行的检查必须写明。
- 验证并审查差异后，仅对本任务相关文件或代码块形成独立本地提交；遵循 [Git 规则](rules/git.md)。

## 上下文读取与维护

- 从[上下文索引](.agents/context/index.json)选择本次所需 key；已知 key 批量精确读取，未知 key 先搜索 key、别名和摘要，再读当前段落或 JSON/YAML 字段。摘要仅定位，保留未覆盖项。
- 读取责任随工作流的 start、plan、implement、verify、handoff 节点执行。已读且来源未变的内容可以复用；来源、代码或任务假设变化时，只补读新增、过期或未覆盖的材料。Agent 主动执行，本项目没有客户端 hooks 保证自动调用。
- 仅在用户明确调用 `kane-agent-bootstrap` 时，从运行时可见技能入口定位工具，使用其 `context get/search/check/node/update`。普通任务或工具不可用时直接读取索引及其来源，照同一协议维护；不自动调用技能或阻塞工作。
- `project.yml` 声明环境并引用真实配置；`project.json` 保留产品状态入口；业务正文留在现有文档，本任务事实留在 `workflow-state.json` 明确指向的唯一任务文件。不另建全局任务状态或原文镜像。
- 先更新事实所属文件，再增量维护受影响索引，保留他人条目。交接前核对变化文件及本次已用 key；`sources` 过期时先重读当前来源、修正或重证结论，再更新摘要。重要决定在任务内记录理由、来源、反证条件及下一步。
- 索引随版本控制；`.agents/state/` 只保存本机收据。跨来源的新稳定结论仅在现有文档无合适归属时放入 `.agents/context/derived/` 并登记依赖。

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
