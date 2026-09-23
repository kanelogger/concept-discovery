# concept-discovery

为人与 Agent 的当前任务推荐有用的方法论，并生成上下文化 Prompt。当前产品状态和事实入口见 [项目清单](project.json)，不要将草稿或待办当成已实现能力。

## 每次开始

- 先检查 `git status --short --branch`，保留已有及并发修改。
- 读 [当前任务状态](workflow-state.json) 和它指向的任务文件；新任务按 [工作流](workflow/README.md) 建档。
- 产品相关变更先读 [产品契约](specs/product-contract.md)，通过其中的来源链接按需加载原始材料。

## 工具与完成标准

- 环境问题运行 `npm run doctor`；仓库公共检查为 `npm run check`，详见 [命令说明](docs/agent-environment/commands.md)。
- 行为变更同步补充有回归价值的自动化测试，并实际执行。文档小改不编写镜像测试，执行相称检查即可。
- 完成前更新任务中的证据、未决事项及下一步，同步 `workflow-state.json`；失败或未运行的检查必须写明。
- 验证并审查差异后，仅对本任务相关文件或代码块形成独立本地提交；遵循 [Git 规则](rules/git.md)。

## 按需读取

- 环境、服务与权限：[AI_ENVIRONMENT.md](AI_ENVIRONMENT.md)
- 测试与 CI：[验证规则](rules/testing.md)
- 密钥、私有上下文与外部写入：[安全边界](rules/security.md)
- 后续工作：[待办](tasks/backlog.md)

本文件只保留稳定入口。具体命令以 `package.json` 为准，领域差异留在产品契约，临时结论留在任务记录；不得把本次机器权限写成后续会话的授权。

## Agent skills

### Issue tracker

Work is tracked in local Markdown under `tasks/`, indexed by `tasks/backlog.md` and coordinated through `workflow-state.json`. See `docs/agents/issue-tracker.md`.

### Triage labels

Use the default triage state names in task Markdown. See `docs/agents/triage-labels.md`.

### Domain docs

Read the active task and relevant product contract and ADRs before domain work. See `docs/agents/domain.md`.
