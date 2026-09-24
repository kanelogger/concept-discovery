# 0020：根据 Web 原型更新稳定领域术语

## 目标与范围

依据已接受的独立 Concept CRUD / Dashboard 原型观察及 [产品契约](../specs/product-contract.md)，更新 [领域词汇表](../CONTEXT.md) 中与 Concept 目录、语言版本及浏览/推荐资格有关的稳定词义。原型代码保留在独立工作区，仅作参考。

## 验收条件

- 词汇表清楚区分目录收录、按语言可浏览、按语言可推荐，说明同一 Concept 的中英文内容归属。
- 卡片/表格、Dashboard 首屏顺序及原型的 Ready/Draft 展示不被写成领域规则；不改生产 PRD 或原型代码。
- `npm run validate` 与 `git diff --check` 通过，审查并独立提交本任务文件。

## 工作分工与进度

- 负责人：主 Agent；仅负责主工作区的 `CONTEXT.md`、本任务记录和 `workflow-state.json`。
- 进度：词汇表已更新，文档校验和差异审查通过。

## 决策与未决事项

- 2026-09-24：产品契约明确 Card First、Concept CRUD 与 Dashboard 分工，以及按语言浏览/推荐资格。独立 demo 的任务 0018/0019 记录了 Concept 库卡片/表格视图和移除 C 工作区；当前 A/B 两种首页顺序仍在原型中并存，故不把任一种首页顺序写入领域词汇表。
- 用户提供的 `/private/tmp/concept-discovery-main-task-handoff-2026-09-24.md` 已在独立 demo 的清理任务中作为临时物料删除；依据 demo 任务记录及该任务的交接消息核对原型结论。原型指标、生命周期状态和正式 Schema 仍待定。
- 本次无须 ADR：术语澄清未产生难以逆转的架构取舍。

## 验证证据

| 日期 | 命令或审查 | 结果 / 退出码 | 证据及未覆盖范围 |
| --- | --- | --- | --- |
| 2026-09-24 | `npm run validate` | passed / 0 | 项目清单、工作流状态、必需路径与 36 份 Markdown 本地链接通过；不检验原型的产品行为。 |
| 2026-09-24 | `git diff --check` 与词义审查 | passed / 0 | 无空白错误；新增术语均能在 PRD / 产品契约中找到对应边界，未引入原型的示例状态。 |

## 交接

完成后按 [后续任务](backlog.md) 定稿正式 Concept Schema、生命周期与各语言推荐资格；本次词汇表不代替字段契约。
