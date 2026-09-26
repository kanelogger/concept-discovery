# 0025：维护各语言 WebP 配图与 Wiki 链接

Status: done

实施记录：2026-09-25 在独立 `codex/concept-mvp-demo` 工作区启动；0024 已完成并提交 `b647047`。媒体资产将存入同一 SQLite 数据库，使图片与文字的一次保存可在单一事务内提交，并保留历史内容哈希引用。

**Parent:** [P1 实施任务](0022-implement-concept-schema-crud-dashboard.md)

**What to build:** 用户能分别为中文和英文 Concept 上传、预览、替换或移除 WebP 配图，并维护各自可选的 Wiki 外部链接；详情只展示当前语言的资源。

**Blocked by:** [0024：双语浏览与搜索 Concept 目录](0024-bilingual-browse-search.md).

## Acceptance criteria

- [x] 两种语言分别上传、预览、替换和移除 WebP；校验实际文件格式，提示 2 MB 目标大小，失败时内容与图片引用不发生部分更新。
- [x] 缺图的可浏览卡片显示占位图；当前语言的卡片和详情不回退到另一语言图片。
- [x] 两种语言分别添加、修改或清空可选 `wiki_url`；非绝对 HTTPS URL 被拒绝，未填写时详情不显示入口，链接与出处文本相互独立。
- [x] 图片与 Wiki 修改进入同一 Concept 的 Revision，标明语言和旧/新引用；历史图片在修订保留期间可访问。
- [x] 使用隔离数据验证两语言独立更新、错误文件/URL、重启后资源仍可读取及无跨语言回退。

## 实施与证据

- `media_assets` 在同一 SQLite 保存 WebP 字节、内容哈希和元数据。Concept 的各语言 `cover_image` 保存哈希；`GET /api/assets/:hash` 返回资产。编辑器将文字、Wiki 和各语言图片操作提交为一次版本检查和事务；旧哈希保留供 Revision 引用。2 MB 是编辑器提示，JSON 请求另有 32 MB 传输保护上限。
- 隔离 API 测试使用两张真实 WebP：中文上传红图、英文上传同图、中文替换蓝图和移除均产生带 `locales.<lang>.cover_image` 的 Revision；旧哈希在替换与重启后仍可读取。伪 WebP 与非 HTTPS Wiki URL 被拒绝，同次文字或媒体更改均未提交；两种语言的 Wiki 独立。
- Playwright 在隔离库确认中文上传前预览、保存后卡片和详情渲染及 Wiki 链接；英文起初 0 图片、0 Wiki 链接，随后独立上传蓝图与链接。伪 `.webp` 文件连同描述修改提交时报错，保存版本保持 v3；再次编辑移除英文图和 Wiki 后版本为 v4，中文图与 Wiki 保持。浏览器测试库与伪文件已删除。
- 2026-09-25：`npm run test:product`、`npm run check`、`npm run demo:build`、`git diff --check` 均通过。Playwright 产物目录被 Git 忽略。

## 未决与下一步

- 0026 补齐各语言可推荐资格字段及降级提示。0028 实施永久删除时须同时清理该 Concept 不再被历史引用的媒体资产。
- 资产校验检查 WebP RIFF 容器与首图像块签名，不执行完整像素解码；损坏的内部编码仍可能在浏览器显示失败。
