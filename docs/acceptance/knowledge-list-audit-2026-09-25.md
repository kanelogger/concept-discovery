# 知识清单导入前审计（2026-09-25）

用户提供的 `/Users/kanehua/project/concept-discovery/docs/knowledge-list.json` 是 **80 条双语 Concept 目录候选**，不是含任务输入、`locale` 和人工 `expected_ids` 的 Eval 案例。原文件留在用户提供的位置；隔离 demo 工作区未复制、改写或导入。审计时 SHA-256 为 `619abeaf8811cfeacea504fe63523fae32c42d58df39d48ed5d6d3c85f1b131e`，`count` 与 `items.length` 均为 80，ID 无重复。

## Registry 预览结果

用当前 `Registry.previewCreate` 对每条原字段只读预览，**0/80 可原样导入**。当前契约仅接受 `formal_model`、`empirical_finding`、`heuristic`、`principle`、`framework`、`law`、`bias` 等 `epistemic_type`；39 条使用未支持值（`concept` 2、`effect` 13、`fallacy` 4、`method` 6、`model` 11、`theory` 3）。79 条含未支持的 `domains` 代码，80 条含未支持的 `intents` 代码。其 `source` 和 `schema_reference` 字段指向的 `raw/past/daily-knowledge-methodology.md`、`raw/2026/09/day/2026-09-24/case.json` 在用户给出的仓库位置均不存在。

每条均有中英文名称、描述、非空 `source_text`、触发场景和 Agent 指引；160 个语言图片字段都为空。用户已决定无图时显示默认配图，图片不再是推荐资格条件。只保留 ID 与语言内容作 **只读投影** 后，80/80 机械上双语可浏览、双语可推荐；这不等于已导入、已核实出处或达到 30 个真实双语 Concept 的 Gate。至少 22 条 Concept 的出处明写“示例出处：请替换…”等占位文案；非空校验会误将这些文案算作出处，正式导入前需要处理。

## 决策与下一步

- 用户确认这份 JSON 用于目录，要求原文件保持不变，并在提供分类映射后再导入。待定映射覆盖不兼容的 `epistemic_type`、`domains` 和 `intents`；导入时不得静默清空这些字段。
- 占位出处如何处理仍待用户决定。真实出处不作外部自动核验，但占位语不能作为已完成来源的证据。
- 取得映射后，在隔离数据库先做全量预览和冲突检查，再导入；核对每条 ID、双语字段、Revision、Dashboard 与推荐池。提供含人工 Expected 的独立 Eval 数据集后才运行 0040 正式质量评测。100 次真实主动调用仍须从真实 Usage 取得。
