# 0027：查看 Revision 并阻止过期编辑

Status: ready-for-agent

**Parent:** [P1 实施任务](0022-implement-concept-schema-crud-dashboard.md)

**What to build:** 管理员能在 Concept 详情中查看真实修订，区分共用字段、各语言文字、图片与 Wiki 链接的变化；两个会话编辑同一 Concept 时，较旧提交不会覆盖新版本。

**Blocked by:** [0025：维护各语言 WebP 配图与 Wiki 链接](0025-localized-image-wiki.md).

## Acceptance criteria

- [ ] 修订列表显示全局版本、时间、操作与变更字段；已存在的各语言字段带 `cn` / `en` 归属，图片显示旧/新资产引用或摘要，Wiki 链接变化可追溯；新增字段沿用同一展示规则。
- [ ] 从创建版本 1 起的实际变更可查看；无变化的保存不新增版本或修订，图片二进制不写入修订正文。
- [ ] 编辑提交带所见版本；两个会话先后提交时，过期提交被拒绝并提示重新载入，已保存版本不受影响。
- [ ] 历史修订引用的图片仍可访问；公开操作和浏览器测试覆盖当前已可编辑的文字、图片、Wiki 及并发冲突。并行切片新增的共用字段由其自身验收覆盖。
