# concept-discovery

基于当前任务和对话上下文，发现有价值的方法论，并生成可执行的 Prompt。产品计划由本地 Method System 和 Agent Method Skills 组成。

**当前状态：协作开发环境已初始化，产品尚未实现。** 本仓库目前提供产品材料、任务交接和可运行的环境检查；尚无 Web UI、服务、正式 Registry 或推荐 Skill。

## 开始开发

需要 Node.js 24、npm 和 Git。在仓库根目录执行：

```sh
npm ci --ignore-scripts
npm run doctor
npm run check
```

当前无第三方依赖，也不需要 API Key、数据库或网络服务。`doctor` 检查当前机器的工具链；`check` 校验协作契约、文档本地链接并运行工具测试，不代表产品验收通过。完整命令见 [环境命令](docs/agent-environment/commands.md)。

## 人与 Agent 如何协作

1. 新会话先读 [AGENTS.md](AGENTS.md) 和 [当前任务状态](workflow-state.json)，沿索引加载本次需要的材料。
2. 用 [任务模板](workflow/task-template.md) 写清目标、范围和可观察的验收条件；流程见 [协作工作流](workflow/README.md)。
3. 在任务授权范围内完成本地实现和验证；并行任务先划分文件所有权，交接留下证据、阻塞和下一步。
4. 交付前运行相称检查，更新任务及状态，审查差异后形成独立本地提交。推送和发布按用户指令执行。

## 资料入口

| 入口                                                 | 内容                             |
| ---------------------------------------------------- | -------------------------------- |
| [文档索引](docs/README.md)                           | 两份原始产品输入及其状态         |
| [产品契约与未决事项](specs/product-contract.md)      | 产品方向、材料差异、未来验收边界 |
| [环境索引](AI_ENVIRONMENT.md)                        | 真实可用的命令、能力和 CI 差异   |
| [开发待办](tasks/backlog.md)                         | 下一阶段任务及验收条件           |
| [初始化记录](tasks/0001-bootstrap.md)                | 本次范围、决策与验证证据         |
| [环境决策](docs/adr/0001-collaboration-bootstrap.md) | 为什么采用当前最小协作底座       |
