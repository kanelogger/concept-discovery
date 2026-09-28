# 0054 untools 模型数据本地化

## 目标与范围

把 [untools.co](https://untools.co/) 的 25 个思维工具页面抓取为本地 Markdown 资料，供后续概念库人工参考：

- 每个工具一个目录：`docs/private-project/models-data/<slug>/`，内含 `index.md` 与 `assets/`（图片）。
- 使用 Skill `baoyu-url-to-markdown`（`baoyu-fetch` CLI，Chrome CDP + Defuddle），本地下载图片并改写链接。
- `docs/private-project/` 被 `.gitignore` 的 `private-*/` 规则忽略，属本地私有资料，不进入提交。
- 不改动产品代码、契约或数据库。

工具清单（取自首页 25 个内链）：

abstraction-laddering, balancing-feedback-loop, concept-map, confidence-determines-speed-vs-quality,
conflict-resolution-diagram, connection-circles, cynefin-framework, decision-matrix, eisenhower-matrix,
first-principles, hard-choice-model, iceberg-model, impact-effort-matrix, inversion, ishikawa-diagram,
issue-trees, ladder-of-inference, minto-pyramid, ooda-loop, productive-thinking-model,
reinforcing-feedback-loop, second-order-thinking, situation-behavior-impact, six-thinking-hats, zwicky-box

## 验收条件

- 25 个目录各含非空 `index.md`，正文含标题与实质内容（非空壳/报错页）。
- 页面图片下载到 `assets/`，`index.md` 中图片引用路径为 `assets/...`，不残留 `imgs/`、`videos/` 目录或远程图片链接。
- 抽查若干页面（含 six-thinking-hats、一个无插图页面）人工确认质量。
- `npm run validate` 通过。

## 工作分工与进度

单 Agent 顺序执行；无并行任务冲突。数据目录为新增本地目录，不触碰仓库受版本控制文件（除本任务文件与 `workflow-state.json`）。

## 决策与未决事项

- 用户偏好 `~/.baoyu-skills/.../EXTEND.md` 为 `download_media: 0`；按优先级 CLI 参数覆盖，显式传 `--download-media`，符合用户"图片放到 assets"的要求。
- CLI 固定输出 `imgs/`、`videos/` 子目录；抓取后统一改名为 `assets/` 并改写链接。
- 输出结构采用用户指定布局（`<slug>/index.md`）而非 Skill 默认的 `<domain>/<slug>/<slug>.md`。
- 保留 frontmatter（title/url/summary/coverImage 等元数据），`coverImage` 同步改写为 `assets/` 路径。

## 验证证据

| 日期 | 命令或审查 | 结果 / 退出码 | 证据及未覆盖范围 |
| --- | --- | --- | --- |
| 2026-09-28 | 单页试抓 six-thinking-hats | passed | 6.8s；正文、3 张图、Sources 完整，链接可改写 |
| 2026-09-28 | 批量抓取 25 页（`/tmp/untools-fetch/fetch-all.sh`，4 并发） | passed | 25/25 `rc=0`，46.9s；总 5.2MB |
| 2026-09-28 | 结构校验（自定义脚本） | passed | 25 目录/25 篇 index.md；无 `imgs/`、`videos/` 残留；所有 `assets/` 引用与 frontmatter `coverImage` 均指向存在的文件；无远程图片与 `data:` 图片；assets 无未引用文件 |
| 2026-09-28 | 内容覆盖对照（live 页面 vs 本地） | passed | 正文词数覆盖 0.76–0.98，差异为导航/页脚/相关工具/订阅模块，非正文缺失 |
| 2026-09-28 | 图片审计（live `<main>` vs assets） | passed | 发现 issue-trees 漏抓 `issue-tree-example-1.png`，已手工补抓并插入正确位置；其余差异全部为页脚"相关工具"图标（非正文，Markdown 不引用） |
| 2026-09-28 | 人工抽查（six-thinking-hats、inversion、situation-behavior-impact、minto-pyramid、connection-circles、issue-trees） | passed | 结构、图片位置、来源链接与原文一致 |
| 2026-09-28 | `npm run validate` | passed | `PASS project manifest, workflow state, required paths, and local links in 91 Markdown files` |

## 交接

完成：25 个工具页面已本地化，结构校验、图片审计与人工抽查通过。数据位于 `docs/private-project/models-data/`（gitignore，本地私有）。抓取脚本与日志保留在 `/tmp/untools-fetch/`（临时目录，重启后可能丢失；需要重新抓取时按工作分工中的命令重建即可）。

未决/风险：
- 页面标题层级沿用源站（inversion、situation-behavior-impact 的标题在源站即为 h2，Markdown 保留 h2，不做层级改写）。
- frontmatter 由 defuddle 生成；inversion 与 situation-behavior-impact 的 `title` 已去掉源站后缀 " | Untools" 以保持一致。
- 未抓取 about/templates/thinking-tools-guide 等非工具页；如后续需要另行处理。

