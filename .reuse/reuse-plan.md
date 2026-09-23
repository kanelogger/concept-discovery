# 复用计划

## 需求摘要

本轮问题聚焦产品形态：一个本地 / 自托管的管理系统维护一组 Agent Skills，并通过 Skills、MCP 或 CLI 把能力交给 Agent。原产品目标仍包含方法 Registry、根据对话识别适用方法、推荐解释及上下文化 Prompt。旧一轮关于思维模型内容的检索保留在 [任务 0002](../tasks/0002-github-reuse-scout.md)。

## 目标框架

Node.js / TypeScript（用户前轮已确认）。本轮最接近项目 Skillbox 使用 React、Bun、Hono 与 PostgreSQL；MySkills 是 TypeScript / Fastify 多包架构。是否接受 Docker + PostgreSQL、自托管和单体部署仍待用户确认。

## 候选清单（手动相关度排序；脚本评分不可用）

| 排名 | 仓库 | 分值 | 简述 |
| --- | --- | --- | --- |
| 1 | [kitze/skillbox](https://github.com/kitze/skillbox) | 手动筛选，未生成数值分 | MIT；自托管 Web 管理、版本化 Skill Library、MCP、Node/Bun stdio、bootstrap Skill、任务相关 Skill 推荐；React + Bun + Hono + PostgreSQL。形态最接近。 |
| 2 | [xingkongliang/skills-manager](https://github.com/xingkongliang/skills-manager) | 手动筛选，未生成数值分 | MIT；本地桌面应用，集中管理 / 同步到多种 Agent；附可安装的 `manage-skills` Agent Skill；支持全局 / 项目工作区及本地 Git 备份。 |
| 3 | [jremick/myskills](https://github.com/jremick/myskills) | 手动筛选，未生成数值分 | Apache-2.0；自托管 Skill Registry，含 Web、API、CLI、MCP、版本管理和审核流程；TypeScript 多包架构，当前处于 beta。 |
| 4 | [scalefocus/skilly](https://github.com/scalefocus/skilly) | 手动筛选，未生成数值分 | Apache-2.0；自托管企业级 SKILL.md Registry，含版本治理、权限、审计和管理 Web 应用；更偏组织治理。 |
| 5 | [nikships/skills-registry](https://github.com/nikships/skills-registry) | 手动筛选，未生成数值分 | Apache-2.0；个人 GitHub Skill Registry、CLI、macOS 管理 App 和轻量 gateway Skill；依赖 GitHub 作为中心存储。 |

## 深入检查（top 3）

本轮搜索查询：`agent skills management system`、`local first AI agent skills registry`、`self hosted agent skills dashboard`、`agent skills management language:typescript`、`Agent Skills 本地 管理 系统`。GitHub 搜索脚本的 API / `gh` / `curl` 网络路径不可用，改用网页搜索，并检查下列 GitHub README、文件树、manifest 入口和许可证页面；未生成 API 数值评分，也未声称已实际克隆或运行候选。

1. **kitze/skillbox** — README 定义为自托管、版本化的 Agent Skills Library。功能包含 Markdown / 文件编辑、不可变修订和恢复、Skill / bundle 权限、HTTP MCP 与 Node/Bun stdio、Skill manifest 兼容检查、导入导出及可选的任务相关推荐。`bootstrap/SKILL.md` 是 Agent 侧入口，可用 MCP 工具搜索、推荐、载入和读取 Skill。目录含 `src/`、`cli/`、`bootstrap/`、`tests/`、Docker 部署和 Bun lockfile；MIT。README 给出的本地启动使用 Docker Compose，打开 `127.0.0.1` Web UI；支持本地开发的 PostgreSQL 16+。它覆盖本轮指定的“管理系统 + Skills + Agent 接口”组合，但数据资产是通用技能库，并非已策展的思维方法 Registry；其推荐需要接入外部模型提供商，提供商可用性 / 费用 / 数据处理均由使用者负责。
2. **xingkongliang/skills-manager** — README 描述本地桌面应用，中心 Skill 库默认为 `~/.skills-manager`，支持导入、搜索、预设、项目工作区、多 Agent 同步、更新检查和备份。另提供 `skills/manage-skills`，可把管理功能本身部署给 Agent。根目录有 `src/`、`src-tauri/`、独立 Skill 目录、TypeScript 配置和锁文件；MIT。它是“本地管理界面 + 一个管理型 Agent Skill”的直观范例，Agent Skills 是由用户自行导入管理的，不负责方法论诊断或推荐业务。
3. **jremick/myskills** — README 描述面向 Agent Skills 的 Web / API / CLI / MCP 平台，具有发布、审核、版本、校验、风险扫描、安装与回滚能力。目录按 `apps/`、`packages/` 拆分 API、Web、CLI、MCP、共享 Skill Package；Docker Compose、PostgreSQL / 对象存储、Apache-2.0。当前自述为 beta，README 明确指出 API 合约、包格式与部署默认值在 v1.0 前可能改变；项目较新且页面只显示 1 star，商业生产成熟度不能由结构或功能描述推断。

补充候选：`scalefocus/skilly` 偏多团队身份、审核、审计和企业治理；`nikships/skills-registry` 偏个人 GitHub 仓库同步、CLI / TUI 与原生 macOS UI，代理端依赖 gateway Skill。二者可作为治理与跨 Agent 同步的补充参考。

## 复用决策：reference

产品形态有多个直接先例。现阶段推荐以 **Skillbox** 为首要架构参考：研究其 Skill 资产模型、Web 管理界面、MCP / Agent bootstrap 边界和本地部署流程。暂不直接 fork，待确认本地运行约束并对照产品专用的 Method Schema、准入审核、诊断和 Compose 流程后再判断是否启动基座迁移。

## 决策依据

- **领域匹配：高（产品形态）；中（产品业务语义）。** Skillbox 清楚覆盖本地管理系统、Skill Library、Agent 侧入口和推荐接口；其数据定义是通用 Skill，并没有为本产品约束 Method 的来源、Trigger、Diagnosis、Transform、Instruction、审核状态与相关方法关系。
- **架构契合：高。** UI / 服务、Registry、MCP / CLI 客户端及 Bootstrap Skill 有明确边界，目录也提供可检查的实现和测试入口。
- **可维护性 / 许可：** Skillbox 为 MIT，目录含 `tests/`、部署脚本、文档和安全材料；MySkills 与 Skills Manager 也有许可及测试 / CI 相关结构。搜索 API 不可用，未获得可靠的 `pushed_at` 数值，故未做基于近期活跃度的评分；MySkills 明示 beta，需谨慎看待生产成熟度。
- **技术栈偏差：** Skillbox 的应用层是 TypeScript / React，运行时为 Bun + Hono，数据库为 PostgreSQL；与已确认的 Node.js / TypeScript 接近，但 runtime、后端框架、数据层不完全相同。Skills Manager 是 Tauri 桌面应用；MySkills 使用 TypeScript / Fastify 多包架构。
- **决策：** 基座的业务模型和关键推荐流程仍有差异；部署形态也待确认。因此本轮定为 reference，避免在未厘清边界时把通用技能库直接认作方法论产品。

## 待确认项

- Skillbox 的本地 Docker Compose + PostgreSQL 形态是否符合预期；是否要求不依赖 Docker、完全离线或使用本地文件型数据库。
- 目标是单用户本地 Web 系统，还是需支持多用户 / 团队权限。
- 确认上述约束后，再定 fork Skillbox 还是以 Node.js / TypeScript 重建同样的 UI / Registry / MCP / Agent Skill 组合。
- 自动化搜索、评分和浅克隆因 GitHub API 网络受限而未完成；若网络恢复可重新跑完整脚本核验活动度和清单。

## 借用单元清单

不适用（reference；本轮不复制上游代码）。

## 迁移状态：不适用

## 迁移日志

- 2026-09-23：第二轮按“本地管理系统 + Agent Skills”产品形态检索。GitHub API / `gh` / `curl` 搜索失败；使用网页搜索和 GitHub 页面手动检查 5 个候选，对前三名检查 README、目录、manifest / 入口及许可信息。建议先 reference Skillbox。`npm run validate` 通过；未克隆或运行上游项目。
