# 0015：Concept CRUD Demo 视觉与响应式优化

## 目标与范围

按用户已确认的设计方向，为临时 Concept CRUD / Dashboard demo 编写 [DESIGN.md](../DESIGN.md)，再优化视觉 token、文字层级、控件状态和响应式布局。沿用 React + Vite + TypeScript + shadcn/ui 风格组件 + Tailwind；不接服务端、不扩大产品功能。

依据：[产品 PRD §8、§27、§28](../docs/method-system-prd-v0.1.md)、[App UI 场景默认](../README.md)、用户确认的方向：保留浅色鼠尾草绿后台，交互使用 L1。

## 验收条件

- DESIGN.md 九个章节完整；颜色全部经 CSS token，含 RGB 辅助值；字体含 Google Fonts URL 和中文 fallback；组件具备交互状态；说明 L1 动效、Do/Don't 与桌面/平板/手机适配。
- 三种布局和 CRUD 能力不回退；Dashboard 指标仍显式标注待定。
- 移动导航进入正常文档流，三栏工作区在窄屏可顺序阅读，中文主要正文不低于 15px。
- 构建、项目校验与浏览器主要视口检查通过。

## 工作分工与进度

- 负责人：主 Agent；独立 demo 全部相关文件。
- 进度：completed；用户已确认方向和 L1 交互。

## 决策与未决事项

- 沿用明亮中性表面与鼠尾草绿主色，收敛为单一强调色；保留后台信息密度和现有三种结构。
- 使用 CSS-only L1：短淡入、边框/底色/阴影 hover、明确 focus-visible；无滚动 reveal、视差或额外动效依赖。
- 中文字体采用 Noto Sans SC，英文为 Inter；保留系统 fallback，提升中文正文可读性。

## 验证证据

| 日期 | 命令或审查 | 结果 / 退出码 | 证据及未覆盖范围 |
| --- | --- | --- | --- |
| 2026-09-24 | `npm run demo:build` | PASS | TypeScript 检查与 Vite production build 完成，1644 个模块构建成功 |
| 2026-09-24 | `npm run validate`、`git diff --check` | PASS | 项目清单、工作流状态、路径及 38 份 Markdown 本地链接通过；无空白差异错误 |
| 2026-09-24 | In-app browser `?variant=A/B/C` | PASS（约 755px 可视宽度） | 三种视图均渲染；Dashboard、卡片库、工作区信息结构明显不同。工作区在该宽度下显示筛选+列表并列、详情在下；未单独设定桌面或 <700px 手机尺寸 |
| 2026-09-24 | Code review | PASS | 变更限定于 DESIGN.md、demo UI/shadcn 风格组件、README 与任务记录；无数据库、真实模型或超范围功能 |


## 交接

更新后的 DESIGN.md 是本 demo 后续 UI 调整的规范来源。完成后提交在 `codex/concept-crud-demo` 分支；本 demo 仍是一次性工作区。
