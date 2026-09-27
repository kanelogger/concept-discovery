# 0014：Concept CRUD 与 Dashboard UI Demo

## 目标与范围

在独立 prototype 分支提供可本地运行的临时前端，用来比较三种 Concept 管理布局并体验内存态 CRUD。栈为 React + Vite + TypeScript + shadcn/ui 风格组件 + Tailwind。产品依据：PRD §8、§27、§28（历史文件 `docs/method-system-prd-v0.1.md`，见下方来源说明）、[产品契约](../specs/product-contract.md)。

本 demo 仅模拟 Concept CRUD 与待定 Dashboard 指标；不连接数据库、真实模型或后端。排除 Recommendation Playground、Prompt 生成、Relation 编辑和 Skill 执行。

## 验收条件

- 一条命令在本地启动；界面明确标记为临时 demo。
- A Dashboard 首页、B Card First 首页、C 并列管理工作区在 `?variant=A|B|C` 下可切换，结构和信息层级不同；三者共用导航与内存数据。
- 可搜索、筛选、查看详情、新增、编辑、删除 Concept；编辑包含中英文标题、描述、图片、可选 wiki_url、标签和备注。
- Dashboard 示例数据和修订指标标记为待定，不暗示是真实运行统计。
- 完成后核对本地构建和页面主要状态；不创建测试镜像 prototype UI。

## 工作分工与进度

- 负责人：主 Agent；独立 demo 工作区全部文件。
- 进度：complete。

## 决策与未决事项

- 使用 `?variant=` 做单应用可分享布局切换；浏览器浮动栏只在开发构建出现。
- 所有状态均为内存状态，重载即重置；图片使用可编辑 URL 和本地视觉占位。
- Dashboard 的数量、语言完整度、最近修订均为待定示例指标。

## 验证证据

| 日期 | 命令或审查 | 结果 / 退出码 | 证据及未覆盖范围 |
| --- | --- | --- | --- |
| 2026-09-24 | `npm run demo:build` | passed / 0 | TypeScript 与 Vite production build 通过；仅验证编译，不代表生产实现。 |
| 2026-09-24 | `npm run validate` | passed / 0 | 项目 manifest、workflow state、必需路径和 36 份 Markdown 本地链接通过。 |
| 2026-09-24 | `git diff --check` | passed / 0 | 无空白错误。 |
| 2026-09-24 | 浏览器检查 A/B/C 与 CRUD | passed | 在本地 Vite 页面检查三种布局、B 的 Dashboard 导航及内存态创建/编辑/删除；刷新即重置。未检查生产部署或真实图床。 |

## 交接

交付后保持该 prototype 位于 `codex/concept-crud-demo` throwaway 分支；由产品实现任务决定是否吸收布局或交互。来源问题是三种结构何者更适合 Concept CRUD 与 Dashboard。依赖安装命令为 `npm install`，本地启动为 `npm run demo`。当前工作树只在 demo 分支中。

> 历史来源说明：旧产品材料已在 0045 合并删除；原文恢复方式见[文档收敛决策](../docs/adr/0004-product-doc-consolidation.md)。本文保留当时的任务或接口记录，不作为当前产品路线图。
