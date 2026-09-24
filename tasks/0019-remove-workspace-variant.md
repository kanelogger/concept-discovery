# 0019：移除 C 管理工作区布局

Status: complete

## 目标与范围

按用户要求删除 `?variant=C` 管理工作区页面及其专用组件，只保留 Dashboard First（A）和 Card First（B）。旧 C 链接应回退到 A，并将地址规范为 `?variant=A`。同步当前 demo 使用说明和布局设计概述。

## 验收条件

- `?variant=C` 不再渲染独立页面，加载后规范到 A；布局切换器和左右方向键只在 A/B 间切换。
- 移除 C 专用三栏布局和只服务于该布局的组件/样式依赖。
- README、DESIGN 的当前说明仅列出 A/B，不改写历史任务记录。
- A/B 的 Dashboard、Concept CRUD、卡片/表格视图仍可使用；`npm run demo:build` 与 `npm run validate` 通过。

## 工作分工与进度

- 负责人：主 Agent；独立 demo 的路由变体、C 专属界面与当前说明文档。
- 进度：complete；用户明确要求移除 `?variant=C` 页面。

## 决策与未决事项

- C 参数通过 `history.replaceState` 规范为 A，保留其他查询参数，避免旧分享链接停留在已删除的变体标识。
- 历史任务记录保留当时三种布局的范围与验证证据；当前 README、DESIGN 更新为两种布局。

## 验证证据

| 日期 | 命令或审查 | 结果 / 退出码 | 证据及未覆盖范围 |
| --- | --- | --- | --- |
| 2026-09-24 | npm run demo:build | PASS / 0 | TypeScript 检查通过，Vite 构建成功；移除 C 布局后输出 1644 个模块。 |
| 2026-09-24 | npm run validate | PASS / 0 | 工作流状态、必需路径及 42 个 Markdown 文件本地链接通过。 |
| 2026-09-24 | 浏览器旧 C 链接和 A/B 导航检查 | PASS | 打开 `?variant=C` 后地址改为 `?variant=A` 并显示 Dashboard；切换到 B 显示卡片库，浮动布局切换仅提供 A、B。最后返回 A 首页。 |
| 2026-09-24 | 代码/文档审查与 git diff --check | PASS / 0 | 删除 C 专属工作区组件与样式说明；当前应用中无 `WorkspaceLayout`、`WorkspaceRow`、`DetailBox` 或 C 条件分支。历史任务文件保留原记录。 |

## 交接

已更新 workflow-state.json 并独立本地提交；demo 仍使用本地内存数据。
