# 0025：维护各语言 WebP 配图与 Wiki 链接

Status: ready-for-agent

**Parent:** [P1 实施任务](0022-implement-concept-schema-crud-dashboard.md)

**What to build:** 用户能分别为中文和英文 Concept 上传、预览、替换或移除 WebP 配图，并维护各自可选的 Wiki 外部链接；详情只展示当前语言的资源。

**Blocked by:** [0024：双语浏览与搜索 Concept 目录](0024-bilingual-browse-search.md).

## Acceptance criteria

- [ ] 两种语言分别上传、预览、替换和移除 WebP；校验实际文件格式，提示 2 MB 目标大小，失败时内容与图片引用不发生部分更新。
- [ ] 缺图的可浏览卡片显示占位图；当前语言的卡片和详情不回退到另一语言图片。
- [ ] 两种语言分别添加、修改或清空可选 `wiki_url`；非绝对 HTTPS URL 被拒绝，未填写时详情不显示入口，链接与出处文本相互独立。
- [ ] 图片与 Wiki 修改进入同一 Concept 的 Revision，标明语言和旧/新引用；历史图片在修订保留期间可访问。
- [ ] 使用隔离数据验证两语言独立更新、错误文件/URL、重启后资源仍可读取及无跨语言回退。
