# 0003：本地管理系统 + Agent Skills 产品形态侦察

- 日期：2026-09-23
- 任务来源：用户要求查找“一个本地管理系统 + 一组 Agent Skills”的相近产品形态
- 当前阶段：complete；机器状态以 [workflow-state.json](../workflow-state.json) 为准

## 目标与范围

以当前产品方向为背景，比较将本地管理界面 / Registry 与 Agent Skills、MCP 或 CLI 组合的 GitHub 项目。关注管理端如何保存、版本化、审核和部署 Skills，以及 Agent 侧如何发现、推荐、加载它们。用户已确认目标栈 Node.js / TypeScript；本轮不实施或复制上游代码。

## 验收条件

- [x] 搜索 3–6 组相关关键词，包含自托管、Skill Registry / 管理 UI 和 Agent Skills 组合。
- [x] 列出至少 3 个候选并检查前三名的 README、目录、入口 / manifest 与许可证。
- [x] 判断产品形态是否有直接先例，记录 fork / reference / none 建议及未决约束。
- [x] `npm run validate` 通过，并记录真实验证结果。

## 工作分工与进度

- 负责人：主 Agent；完成手动网页检索和候选检查。
- GitHub Search API 不可连接，侦察脚本失败；使用公开网页搜索和 GitHub 仓库页作为手动证据。
- 当前复用计划见 [.reuse/reuse-plan.md](../.reuse/reuse-plan.md)；旧一轮方法库检索见 [任务 0002](0002-github-reuse-scout.md)。

## 决策与未决事项

- Skillbox 是最贴近“本地管理系统 + Agent Skills”的组合：带 Web UI、版本化 Skill Library、MCP、Agent bootstrap Skill、CLI / stdio 与任务相关推荐；MIT，TypeScript 应用，Docker Compose + PostgreSQL 部署。
- Skills Manager 是本地桌面形态参考，带可安装的 `manage-skills`；MySkills 是多包 TypeScript 的自托管 Web/API/CLI/MCP Registry，但当前为 beta。
- 当前建议 `reference` Skillbox；其通用技能资产缺少本产品的方法论 Schema、来源准入和诊断/Compose 语义。确认 Docker、单用户/团队等约束后再决定 fork。
- 是否完全离线、不用 Docker或需团队权限尚未确认。

## 验证证据

| 日期 | 命令或审查 | 结果 / 退出码 | 证据及未覆盖范围 |
| --- | --- | --- | --- |
| 2026-09-23 | GitHub 查询脚本（`agent skills management system`） | failed / 1 | `gh api` 与 `curl` 无法连接 `api.github.com`；后续以网页搜索进行手动候选收集。 |
| 2026-09-23 | 网页搜索和 GitHub 页面检查 | passed | 搜索 5 个候选，前三名检查 README、目录、manifest / 入口及许可页面；未克隆或运行上游项目。 |
| 2026-09-23 | `npm run validate` | passed / 0 | project manifest、workflow state、required paths 和 Markdown 本地引用通过；不覆盖外链或上游运行行为。 |

## 交接

当前产品形态存在相近先例。阅读 `.reuse/reuse-plan.md` 查看前五候选和与 Skillbox 的架构比较；若用户确认本地部署形态，再决定是否将目标从架构参考提升为复用基座。
