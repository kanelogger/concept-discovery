# 0017：固定导航与 Dashboard 内容滚动简化

Status: complete

## 目标与范围

调整 Concept Discovery 临时 demo 的 App 外壳，使顶部与桌面侧栏固定，主内容在可用高度内自适应并独立滚动。删除用户指出的 Dashboard provisional 说明区和 Prototype state 提示，并清理静态占位导航、无动作 Help/头像及无功能排序按钮。

## 验收条件

- 应用使用视口高度外壳；头部和桌面侧栏固定，只有内容区按需显示滚动条。
- Dashboard 内容超出时在内容区滚动，头部与侧栏位置保持不动；内容未超出时不出现多余滚动。
- 整个 Dashboard metrics are provisional 说明区删除；侧栏 Prototype state 区删除。
- 删除 Library 静态占位、无动作 Help/头像与无动作排序按钮；保留可工作的导航、过滤、状态和布局切换。
- A/B/C 与 CRUD、上传流程不回退；npm run demo:build、npm run validate 通过。

## 工作分工与进度

- 负责人：主 Agent；仅维护临时 demo 页面壳层、相关占位清理及任务记录。
- 进度：complete；用户明确要求固定头部/侧栏、内容自适应滚动、删除两个说明块并按奥卡姆剃刀清理非功能区块。

## 决策与未决事项

- 将固定头部/侧栏与主内容独立滚动应用于 A/B/C 共用外壳，使导航在每种布局下保持稳定。
- 删除明显无交互行为的占位项；保留示例指标及其轻量“示例数据 · 指标待定”标记、A/B/C 布局切换和内存状态快照。

## 验证证据

| 日期 | 命令或审查 | 结果 / 退出码 | 证据及未覆盖范围 |
| --- | --- | --- | --- |
| 2026-09-24 | npm run demo:build | PASS / 0 | TypeScript 检查通过，Vite 构建成功；1644 个模块。 |
| 2026-09-24 | npm run validate | PASS / 0 | project manifest、工作流状态、必需路径及 40 个 Markdown 文件本地链接通过。 |
| 2026-09-24 | 浏览器 Dashboard/滚动检查 | PASS | 约 755×1000 的浏览器视口中通过 Dashboard 内容元素滚动，主内容区出现纵向滚动，顶部栏与移动导航保持可见；两个目标说明区已消失。视口未达到桌面 xl 断点，桌面侧栏使用视口高 flex 壳层并独立溢出滚动，未直接以宽视口目视验证。 |
| 2026-09-24 | 差异审查与 git diff --check | PASS / 0 | 固定视口应用壳和可滚动主内容覆盖共享 A/B/C 外壳；清掉无动作/占位 UI；保留可用导航、CRUD 和示例数据标记。无空白错误。 |

## 交接

已更新 workflow-state.json 并提交在 codex/concept-crud-demo；临时 demo 仍只使用本地模拟数据，无数据库或真实模型接入。
