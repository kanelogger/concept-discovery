# 0023：持久化 Concept 草稿

Status: done

实施记录：2026-09-25 在独立 `codex/concept-mvp-demo` 工作区启动。应用栈与存储决定见 [ADR 0002](../docs/adr/0002-local-product-stack.md)。

**Parent:** [P1 实施任务](0022-implement-concept-schema-crud-dashboard.md)

**What to build:** 用户能在本地 Web 创建有名称的 Concept 草稿，在管理卡片中再次找到它，重启后仍能继续编辑。首次实施同时记录应用栈与存储选型，建立后续切片共用的 Registry 与修订写入契约。

**Blocked by:** None (can start immediately).

## Acceptance criteria

- [x] 可用合法且唯一的不可变 slug 和至少一种语言的非空名称创建草稿；重复或非法 ID 被拒绝，原数据不变。
- [x] 共用字段与 `locales.cn` / `locales.en` 使用同一 Concept 身份；只填写一种语言时，另一语言仍为空，不做文案回退。
- [x] 创建结果能从本地管理卡片打开、继续编辑并在应用重启后保留；测试使用隔离数据，不写用户 Registry。
- [x] 创建产生版本 1 与可从公开操作读取的第一条 Revision；后续实际保存沿用全局递增版本和带字段路径的修订写入，无变化的保存不增版本。
- [x] 实施前记录应用栈与存储决定；真实读写与浏览器创建流程通过，公共检查通过。

## 实施与证据

- 应用栈和存储决定见 [ADR 0002](../docs/adr/0002-local-product-stack.md)。`npm start` 提供本地 Web 和 API，默认数据库在 `.local/`；产品测试和浏览器验收均显式使用临时数据库。
- 公开 API 创建、读取、列表、按版本编辑和修订读取，SQLite 事务同时提交 Concept 与 Revision。创建版本为 1；编辑只记录变化字段路径；过期版本拒绝；无变化保存保留版本。
- 2026-09-25：`npm run test:product` 首次在沙箱内因 `listen EPERM 127.0.0.1` 失败；允许本地回环监听后重跑通过（1/1）。`npm run check` 通过（27/27），`npm run demo:build` 通过，`git diff --check` 通过。
- Playwright 在隔离数据库创建 `browser-draft`（仅中文名称），管理卡片打开编辑后得到 v2 和 `locales.cn.description` 修订；重启服务后卡片仍显示 v2。切到英文后卡片只显示 ID 与“Content pending in this language”，未回退中文。临时数据库已删除。

## 未决与下一步

- 0024 接续按语言的普通浏览、搜索与管理视图；0023 的页面仅提供管理草稿入口。图片、Wiki、归档、Dashboard 和推荐仍由后续 tickets 实现。
- 旧原型文件仅作 UI 参考，正式入口为 `src/product/App.tsx`；阶段结束时评估是否移除原型文件。
