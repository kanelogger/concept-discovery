# 环境索引

适用范围：concept-discovery 仓库。维护者：本任务执行者；最近核实：2026-09-23。环境变更或新机器进入时重新运行 `npm run doctor`，历史探测不构成当前能力或授权。

| 当前工作 | 按需入口 |
| --- | --- |
| 安装、运行或新增命令 | [命令](docs/agent-environment/commands.md)、[package.json](package.json) |
| 运行时、服务、工具、网络与文件权限 | [运行环境](docs/agent-environment/runtime.md) |
| CI、跨机器差异与发布 | [CI 差异](docs/agent-environment/ci-parity.md) |
| 项目事实、入口和能力登记 | [project.json](project.json) |
| 恢复当前任务 | [workflow-state.json](workflow-state.json) |

`project.json` 登记协作环境契约，`package.json` 定义实际命令。`npm run validate` 检查入口存在、脚本引用、状态一致性和文档本地链接。检查覆盖范围见命令说明。

当前没有项目级 Skill、Hook、MCP Connector、应用服务或发布配置。只有真实需要出现并能验证时才添加；会话中暴露的全局工具由会话自身管理，不固化为项目依赖。

根目录 `AGENTS.md` 维护采用小范围审阅：核对事实来源、移走低频细节、检查链接、用新上下文恢复任务。若规则涉及用户全局配置或外部系统，则按实际任务授权处理。
