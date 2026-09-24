# 0026：显示各语言可推荐资格与降级影响

Status: ready-for-agent

**Parent:** [P1 实施任务](0022-implement-concept-schema-crud-dashboard.md)

**What to build:** 编辑者能补齐各语言触发场景和 Agent 应用指引，看到草稿、可浏览、可推荐资格及缺失条件；保存会让某语言降级的修改前，Web 明确提示影响。

**Blocked by:** [0025：维护各语言 WebP 配图与 Wiki 链接](0025-localized-image-wiki.md).

## Acceptance criteria

- [ ] 编辑器支持各语言的 `trigger`、`avoid_when`、`transform`、`agent_instruction`，并可维护共用的 `domains`、`intents` 及两个独立可空类型；未知受控代码和非法类型被拒绝。
- [ ] 各语言分别按同一规则计算资格：名称、描述、非空出处使其可浏览；再有本语言 WebP、至少一个触发场景和非空 Agent 应用指引才可推荐。类型、Wiki 和另一语言是否齐备不影响结果。
- [ ] 编辑器显示每种语言缺少的字段；移除必要字段或配图导致可推荐降为可浏览、可浏览降为草稿时，保存前明确提示语言与退出范围。
- [ ] 保存后卡片、管理视图和对外资格结果一致；一语言降级不改变另一语言资格。公开操作与浏览器测试覆盖两种语言及非法输入。
- [ ] 本切片新增的共用字段与 Agent 字段修改沿用全局版本及 Revision 写入契约；公开读取能按字段路径追溯变更，不依赖 Revision 页面先完成。
- [ ] 本切片只提供推荐资格数据，不增加推荐任务输入、Playground 或 Prompt 展示。
