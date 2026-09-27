# 0011：为 Concept PRD 增加 cn/en 双语字段与配图

## 目标与范围

根据用户 2026-09-24 的要求，在 PRD（历史文件 `docs/method-system-prd-v0.1.md`，见下方来源说明） 中明确 `cn` / `en` 两套 Concept 可见字段和独立 WebP 配图，并同步 Web、推荐、Prompt Composer、Relation 备注及 Eval 的语言约定。同步 [产品契约](../specs/product-contract.md)、[后续任务](backlog.md)、文档索引和任务状态。本次不实现产品代码。

## 验收条件

- PRD 示例明确区分 `locales.cn` 与 `locales.en`；标题、描述、标签、触发/禁用条件、Agent 指令和图片按语言取值，稳定 ID、类型、Intent、Domain 等跨语言共用。
- Web、搜索、推荐输出、Apply 和 Eval 使用同一显式语言；缺失语言不静默混用另一种语言的文案或图片。
- 关联关系共用 Concept ID，用户可见备注按 `cn` / `en` 区分；前置 Schema/准入任务纳入双语校验。
- `npm run validate` 通过，差异仅包含本次文档与任务状态。

## 工作分工与进度

- 负责人：主 Agent；文件范围为 PRD、产品契约、后续任务、文档索引、本任务记录与 `workflow-state.json`。
- 进度：PRD v0.4、产品契约、待办与索引已同步并验证。

## 决策与未决事项

- 用户已定：Concept 内容字段和配图都分别支持 `cn`、`en`。
- 本次采用 `locales.cn` / `locales.en` 分组，默认界面语言为 `cn`；跨语言共用 ID、受控类型、Domain、Intent 与关系引用。草稿可暂缺语言，正式可推荐条目需两种语言的必填文案和独立 WebP；缺失时不跨语言回退。
- Recommendation 与 Search 显式传 `locale`，日志和 Eval 保留语言；Relation Note 双语，Expected 使用共用 ID。
- 未决：正式 Schema 的逐字段校验、现有中文清洗稿的英文内容与图片制作、翻译审核和旧平铺字段迁移规则，留待 Schema/准入任务完成。

## 验证证据

| 日期 | 命令或审查 | 结果 / 退出码 | 证据及未覆盖范围 |
| --- | --- | --- | --- |
| 2026-09-24 | `npm run validate` | passed / 0 | 项目清单、任务状态、路径及 32 份 Markdown 本地链接通过；未覆盖产品代码。 |
| 2026-09-24 | `git diff --check` 与差异审查 | passed / 0 | 未见空白错误或旧的单图路径、平铺 Concept 字段残留。 |

## 交接

修订已完成；后续先按 [待办](backlog.md)定稿双语 Schema 和准入规则，再制作并审核首批 Concept 的英文内容与两种配图。本次未实现产品代码。

> 历史来源说明：旧产品材料已在 0045 合并删除；原文恢复方式见[文档收敛决策](../docs/adr/0004-product-doc-consolidation.md)。本文保留当时的任务或接口记录，不作为当前产品路线图。
