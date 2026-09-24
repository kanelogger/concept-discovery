# 0026：显示各语言可推荐资格与降级影响

Status: done

实施记录：2026-09-25 在独立 `codex/concept-mvp-demo` 工作区启动；0025 已完成并提交 `7bade73`。服务端已按 P1 契约计算每语言资格，本票新增编辑字段、公开预览与保存前降级确认。

**Parent:** [P1 实施任务](0022-implement-concept-schema-crud-dashboard.md)

**What to build:** 编辑者能补齐各语言触发场景和 Agent 应用指引，看到草稿、可浏览、可推荐资格及缺失条件；保存会让某语言降级的修改前，Web 明确提示影响。

**Blocked by:** [0025：维护各语言 WebP 配图与 Wiki 链接](0025-localized-image-wiki.md).

## Acceptance criteria

- [x] 编辑器支持各语言的 `trigger`、`avoid_when`、`transform`、`agent_instruction`，并可维护共用的 `domains`、`intents` 及两个独立可空类型；未知受控代码和非法类型被拒绝。
- [x] 各语言分别按同一规则计算资格：名称、描述、非空出处使其可浏览；再有本语言 WebP、至少一个触发场景和非空 Agent 应用指引才可推荐。类型、Wiki 和另一语言是否齐备不影响结果。
- [x] 编辑器显示每种语言缺少的字段；移除必要字段或配图导致可推荐降为可浏览、可浏览降为草稿时，保存前明确提示语言与退出范围。
- [x] 保存后卡片、管理视图和对外资格结果一致；一语言降级不改变另一语言资格。公开操作与浏览器测试覆盖两种语言及非法输入。
- [x] 本切片新增的共用字段与 Agent 字段修改沿用全局版本及 Revision 写入契约；公开读取能按字段路径追溯变更，不依赖 Revision 页面先完成。
- [x] 本切片只提供推荐资格数据，不增加推荐任务输入、Playground 或 Prompt 展示。

## 实施与证据

- 新建草稿和更新草稿均调用服务端只读资格预览，按同一规则显示中文、英文的 `browse_missing`、`recommend_missing`。更新预览复用正式保存的字段、媒体校验及版本检查。编辑器提供四组各语言 Agent 字段和共用受控字段；保存前按语言列出退出推荐池、退出浏览和搜索的影响，取消确认不写入。
- 隔离 HTTP 测试覆盖新建预览不写入、双语晋级、单语降级、草稿降级预览、未知领域和非法类型拒绝、全局版本与字段路径 Revision；中英文分别查询可推荐状态。浏览器以隔离库验证中文清空 `trigger` 后实时从 Recommendable 变为 Browsable，取消确认维持 v2，接受后为 v3；英文卡片仍是 Recommendable v3。
- 2026-09-25：`npm run test:product` 4/4、`npm run check` 30/30、`npm run demo:build` 和 `git diff --check` 均通过。浏览器测试仅连接本机临时数据库。

## 未决与下一步

- 0027 实现 Revision 历史及版本冲突处理；0028 实现归档、恢复与永久删除。推荐任务输入、Playground 和 Prompt 展示留给 P2–P5 已限定范围的后续 ticket。
