# 0043：统一软删除文案

Status: complete

## 范围

将管理视图卡片、表格、详情弹窗中的活跃 Concept 软删除操作统一显示为“删除 / Delete”，三处共用一条确认提示，说明记录将移入归档筛选且可恢复。归档状态名和恢复入口保留。

## 验收条件

- 中文和英文模式下，卡片、表格、详情弹窗的活跃记录操作分别显示“删除”和“Delete”。
- 三种入口触发相同确认提示，说明删除会移入归档并可恢复。
- 已归档记录的恢复和永久删除操作不变。

## 验证

- `npm run demo:build`：passed。
- `npm run validate`：passed。
- `git diff --check`：passed。
- `npm run check`：2026-09-26 在允许临时本机监听后重跑，76/76 通过；首次受限沙箱执行因 `listen EPERM` 未完成。
