# 0004：PRD 与产品契约一致性修复

## 目标与范围

审阅 `docs/method-system-prd-v0.1.md` 后，修复工作区中发现的完整性、版本、交叉引用与契约一致性问题。产品功能仍不实现；本任务只交付文档与校验能力。

范围：

- 清除误插入 `docs/method-registry-curated-v0.1.md` 的 PRD 内容（工作区事故，非设计变更）。
- 统一 PRD 版本标识，保持文件名与正文一致。
- 修正 `specs/product-contract.md`、`tasks/backlog.md` 中指向已重排 PRD 的失效锚点，并更新冲突/缺口表。
- 对齐 `README.md`、`docs/README.md` 的产品命名描述。
- 补齐 PRD 中明确的自相矛盾点（空推荐表示、`tags` 字段、Why Now 字段、初始数量口径），并补回风险与隐私边界两节。
- 为 `scripts/validate.mjs` 增加 Markdown 锚点校验，使同类漂移可被 `npm run check` 拦截。

不做：产品代码、Registry、Web、推荐引擎；不重命名 `method-*` 文件；不擅自为 Eval 设定数值门槛。

## 验收条件

- `docs/method-registry-curated-v0.1.md` 与 HEAD 一致，无 PRD 内容。
- 仓库内所有 Markdown 本地链接（含锚点）通过 `npm run validate`；新增锚点校验有回归测试。
- `specs/product-contract.md` 的每个 PRD 引用都指向现存章节，冲突/缺口表反映新版 PRD。
- `tasks/backlog.md` 的两处 PRD 引用指向现存章节。
- PRD 对空推荐给出唯一机器表示；`tags` 进入数据模型；`reason` 与 Why Now 的关系明确；初始数量口径不冲突；存在风险/未决问题与隐私边界两节。
- `npm run check` 通过。

## 工作分工与进度

单任务，Agent 独立完成。文件所有权：`docs/`、`specs/`、`tasks/`、`README.md`、`scripts/validate.mjs`、`tests/environment.test.mjs`、`workflow-state.json`。

## 决策与未决事项

- PRD 版本：保留 `v0.1`（与文件名及仓库全部引用一致）；工作区误插入副本中的 `v0.2` 属事故产物，已随还原移除。若确需升版，应作为独立变更并同步文件名与引用。
- 命名：PRD 已将产品命名为 Concept Discovery、实体命名为 Concept；文件路径中的 `method-*` 与清洗稿正文的 Method 属遗留命名。本任务只在描述层对齐，文件重命名留待 ADR。
- 空推荐：机器接口统一为 `recommendations: []`，`NONE` 仅作展示层标签。
- Eval 数值门槛、判定方式与场景来源仍未定，保留为未决事项，不虚构指标。

## 验证证据

| 日期 | 命令或审查 | 结果 / 退出码 | 证据及未覆盖范围 |
| --- | --- | --- | --- |
| 2026-09-24 | `npm run check` | passed | validate 通过且 25 个测试全过，含新增锚点用例；未执行产品验收（产品未实现） |

## 交接

还原并修复文档一致性问题；新增锚点校验与测试。完成后同步 `workflow-state.json`，在 Git 历史中查询提交哈希。
