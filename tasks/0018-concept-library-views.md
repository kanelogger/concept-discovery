# 0018：Concept 库固定筛选与双视图

Status: complete

## 目标与范围

优化独立 Concept 卡片库：让搜索/状态/标签筛选区与视图切换 tab 在结果滚动时保持可见；支持卡片列表与表格列表两种密度；删除用户指定的英文副文案。保持现有本地模拟数据和 CRUD，不改变 C 管理工作区的结构。

## 验收条件

- Concept 库的搜索、状态、标签、结果数量及视图 tabs 构成同一固定筛选区；向下滚动结果时该区保持可见。
- Card list 与 Table list 可切换，当前筛选与结果一致，两种视图都支持选择、编辑与删除 Concept。
- 删除 “A calm place to collect and maintain reusable concepts.” 文案。
- A/B/C 导航和 CRUD 保持可用；`npm run demo:build` 与 `npm run validate` 通过。

## 工作分工与进度

- 负责人：主 Agent；仅修改独立 demo 的 Concept 库 UI、设计说明与本任务记录。
- 进度：complete；用户明确要求固定搜索区、增加 card-list/table-list tabs 并移除指定文案。

## 决策与未决事项

- Tabs 作为列表级视图切换，仅作用于独立 Concept 库页面；C 管理工作区继续保留其筛选、卡片列、详情列布局。
- 固定区同时容纳筛选器和 tabs，避免滚动列表后失去检索或视图切换入口。

## 验证证据

| 日期 | 命令或审查 | 结果 / 退出码 | 证据及未覆盖范围 |
| --- | --- | --- | --- |
| 2026-09-24 | npm run demo:build | PASS / 0 | TypeScript 检查通过，Vite 成功构建 1644 个模块。 |
| 2026-09-24 | npm run validate | PASS / 0 | 工作流状态、必需路径及 41 个 Markdown 文件本地链接通过。 |
| 2026-09-24 | 浏览器 Concept 库检查 | PASS | 约 755×1000 视口下验证卡片滚动时搜索/筛选栏与视图切换保持可见；Card list 和 Table list 可切换。窄视口表格优先展示标签、状态与操作，最近更新时间移至桌面宽度展示，编辑和删除按钮可见。 |
| 2026-09-24 | 文案审查与 git diff --check | PASS / 0 | 指定英文副文案已移除，差异无空白格式错误。 |

## 交接

已更新 workflow-state.json 并独立本地提交；临时 demo 仍使用浏览器内存模拟数据。
