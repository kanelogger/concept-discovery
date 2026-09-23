# 0002：Method System 相近开源项目侦察

- 日期：2026-09-23
- 任务来源：用户要求搜索与 concept-discovery 类似的项目
- 当前阶段：complete；机器状态以 [workflow-state.json](../workflow-state.json) 为准

## 目标与范围

依据 [产品契约](../specs/product-contract.md)、[PRD](../docs/method-system-prd-v0.1.md) 和 [待办](backlog.md)，检索能覆盖思维方法资产、上下文诊断 / 推荐、Agent Skills、Prompt 生成或方法管理的 GitHub 项目。产出候选证据与 fork / reference / none 决策；本任务不启动产品实现。用户确认目标框架为 Node.js / TypeScript。

## 验收条件

- [x] 记录与当前产品方向一致的需求摘要及可检索关键词。
- [x] 检查至少三个候选的 README、目录结构与许可证；区分直接可复用能力和仅供参考能力。
- [x] 形成复用决策、依据、未决约束和检索限制。
- [x] `npm run validate` 通过，状态文件有对应的真实验证证据。

## 工作分工与进度

- 负责人：主 Agent；串行完成网页检索与候选检查。
- GitHub API 脚本因当前环境无法连接 API 失败；转用网页搜索及 GitHub 仓库页面手动检查。
- 结果与证据索引见 [.reuse/reuse-plan.md](../.reuse/reuse-plan.md)。

## 决策与未决事项

- 决策为 `reference`：`cc-thinking-skills` 与 `model-thinking` 可参考思维方法路由、组合与 Agent Skill 内容组织；`promptsource` 可参考结构化模板与内容管理。未发现一个项目提供完整的 Method Registry、上下文推荐、用户选择和 Compose 闭环。
- 未取得可供脚本评分的 API 元数据；不提供虚构的数值分或活跃度判断。
- 自托管、大型单体和 GPL/AGPL 接受度尚未确认。当前没有直接借用代码的许可需求。

## 验证证据

| 日期 | 命令或审查 | 结果 / 退出码 | 证据及未覆盖范围 |
| --- | --- | --- | --- |
| 2026-09-23 | GitHub 查询脚本（`method recommendation system llm`） | failed / 1 | `gh api` 及 `curl` 无法连接 `api.github.com`；转用网页搜索。 |
| 2026-09-23 | `npm run validate` | passed / 0 | project manifest、workflow state、required paths 和 20 份 Markdown 本地引用通过。未验证外部链接或 API 搜索结果完整性。 |

## 交接

检索产物已记录在 `.reuse/reuse-plan.md`。下一步产品待办仍是 Schema、推荐结果和准入规则定稿；重新获得 GitHub API 网络访问后，可补跑自动化候选、评分及检出证据，但这不影响当前 reference 结论。
