# 0012：为 Concept 增加 Wiki 外部链接

## 目标与范围

根据用户 2026-09-24 的要求，在 [PRD](../docs/method-system-prd-v0.1.md) 中增加 Concept 的 Wiki 外部链接字段，并延续 `cn` / `en` 双语约定。同步 [产品契约](../specs/product-contract.md)、[后续任务](backlog.md)、文档索引与任务状态。本次只修订文档，不实现产品代码。

## 验收条件

- Concept 示例在 `locales.cn` / `locales.en` 下分别包含 `wiki_url`，明确它是可选的用户阅读链接，与 `source.url` 的引用用途区分。
- 详情页按当前语言展示 Wiki 入口，编辑器支持分别添加、修改、移除；缺失语言链接时不跨语言回退。
- Schema 前置任务包含 URL 校验，Concept CRUD 验收包含链接编辑与展示；`npm run validate` 通过。

## 工作分工与进度

- 负责人：主 Agent；文件范围为 PRD、产品契约、后续任务、文档索引、本任务记录与 `workflow-state.json`。
- 进度：PRD v0.5、产品契约、待办与文档索引已同步并验证。

## 决策与未决事项

- 根据前次双语决定，`wiki_url` 放在每种语言的 `locales` 字段下；每种语言至多一个链接，可留空，缺失时隐藏入口。用户没有要求 Wiki 链接必须齐备才能推荐。
- `wiki_url` 用于读者进一步了解 Concept；`source.url` 继续承载内容依据。未来如需多 Wiki 链接，应另行扩展数据结构。

## 验证证据

| 日期 | 命令或审查 | 结果 / 退出码 | 证据及未覆盖范围 |
| --- | --- | --- | --- |
| 2026-09-24 | `npm run validate` | passed / 0 | 项目清单、任务状态、路径及 33 份 Markdown 本地链接通过；未覆盖产品代码。 |
| 2026-09-24 | `git diff --check` 与差异审查 | passed / 0 | 未见空白错误；`wiki_url` 分别进入 cn/en 示例、详情、编辑、Schema 待办与产品验收。 |

## 交接

完成后在 Schema 任务中落地字段和校验，并在 Concept CRUD 中实现编辑及详情页展示。
