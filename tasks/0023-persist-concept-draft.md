# 0023：持久化 Concept 草稿

Status: ready-for-agent

**Parent:** [P1 实施任务](0022-implement-concept-schema-crud-dashboard.md)

**What to build:** 用户能在本地 Web 创建有名称的 Concept 草稿，在管理卡片中再次找到它，重启后仍能继续编辑。首次实施同时记录应用栈与存储选型，建立后续切片共用的 Registry 与修订写入契约。

**Blocked by:** None (can start immediately).

## Acceptance criteria

- [ ] 可用合法且唯一的不可变 slug 和至少一种语言的非空名称创建草稿；重复或非法 ID 被拒绝，原数据不变。
- [ ] 共用字段与 `locales.cn` / `locales.en` 使用同一 Concept 身份；只填写一种语言时，另一语言仍为空，不做文案回退。
- [ ] 创建结果能从本地管理卡片打开、继续编辑并在应用重启后保留；测试使用隔离数据，不写用户 Registry。
- [ ] 创建产生版本 1 与可从公开操作读取的第一条 Revision；后续实际保存沿用全局递增版本和带字段路径的修订写入，无变化的保存不增版本。
- [ ] 实施前记录应用栈与存储决定；真实读写与浏览器创建流程通过，公共检查通过。
