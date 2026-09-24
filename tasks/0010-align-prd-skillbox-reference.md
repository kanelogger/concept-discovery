# 0010：按 Skillbox 参考路线收窄 MVP PRD

## 目标与范围

根据用户 2026-09-24 的决定，修订 [Concept Discovery PRD](../docs/method-system-prd-v0.1.md)、[产品契约](../specs/product-contract.md)和后续任务入口：本地 Skillbox 源码作为参考，不以 Fork 为实施步骤；优先研究并适配 Web、CRUD、Revision、Search、Recommend、Usage；Web 采用 Card First；Concept Card 包含标题、描述、WebP 配图、标签和类型；Relation 支持五种关系并与 Recipe 分离；MVP 主线为 Concept CRUD → Recommendation Playground → Relation → Skill → Feedback / Eval。

## 验收条件

- PRD 的技术路线、页面字段、Relation/Recipe 边界、实施顺序和排除项一致，无“Fork Skillbox”或“沿用上游存储”残留承诺。
- 产品契约与后续任务顺序同步用户已定方向，仍将具体技术和数据契约标为待定。
- 校验器跳过被 Git 忽略的私有参考目录和文件，工作目录的 `npm run doctor`、`npm run check` 通过；回归测试证明公开仓库 Markdown 仍被检查。

## 工作分工与进度

- 负责人：主 Agent；文件范围为 PRD、产品契约、文档索引、后续任务、复用计划补记、校验器及测试、测试入口、命令文档、本任务记录及 `workflow-state.json`。
- 进度：PRD v0.3、契约、待办与文档导航已同步；校验器与测试入口已适配私有参考源码，验证和差异审查已完成。

## 决策与未决事项

- 用户已定：Skillbox 是本地参考实现，不直接 Fork。`docs/private-project/skillbox` 为 Git 忽略的参考副本；优先复用列出的能力设计，不把上游运行时或数据库自动带入本项目。
- 本地核对了 Skillbox 的 `README.md`、`src/client/main.tsx`、`src/server/library.ts`、`src/server/recommendations.ts`、`src/server/schema.ts` 与 `src/server/mcp.ts`：其 Web、修订、搜索、推荐和用量入口存在；Bun、PostgreSQL、Docker 属上游实现事实，不是本项目选型。
- 本地私有参考项目还带有大量测试，原 `node --test` 会递归执行它们；本项目测试入口因此限定为 `tests/*.test.mjs`。
- 未决：各模块是否可直接迁移代码、项目的应用栈和存储引擎、推荐模型提供方，以及既有 Schema/准入规则。后续按模块与 ADR 定稿。

## 验证证据

| 日期 | 命令或审查 | 结果 / 退出码 | 证据及未覆盖范围 |
| --- | --- | --- | --- |
| 2026-09-24 | `npm run doctor` | passed / 0 | Node 24.18.0、Git 与仓库根目录检查通过。 |
| 2026-09-24 | `npm run check`（修正测试入口前） | failed / 1 | 链接校验已通过；`node --test` 扫入被忽略参考项目测试，缺少它们的依赖。 |
| 2026-09-24 | `node --test tests` | failed / 1 | 探索目录参数；Node 将 `tests` 当作模块路径，因此改用 `tests/*.test.mjs`。 |
| 2026-09-24 | `npm run check` | passed / 0 | 链接校验覆盖 31 个仓库 Markdown；26 项本项目测试通过，含私有参考目录回归案例。 |
| 2026-09-24 | `git diff --check`（初次） | failed / 2 | PRD 日期行带 Markdown 硬换行尾随空格；已改为段落分隔。 |
| 2026-09-24 | `git diff --check` 与人工差异审查 | passed / 0 | 无尾随空格；仅本任务相关文档、环境校验与测试入口变更。 |

## 交接

PRD 主线已收敛为五阶段；Skillbox 仅作为本地参考源码。下一步按 [产品待办](backlog.md)定稿 Schema、Core 准入和本地技术选型，再进入 Concept CRUD。尚无产品代码或正式 Registry；本任务完成后仅需本地提交。
