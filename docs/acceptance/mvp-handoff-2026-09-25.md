# Concept Discovery MVP 验收交接（2026-09-25）

固定实施范围：**0023–0029 + 0031–0040**。`0030` 为此前已完成的 P1 票据发布任务，不在本轮实现范围；后续 backlog 新增项目不改变本轮完成条件。隔离工作区为 `/private/tmp/concept-discovery-mvp-demo`，分支 `codex/concept-mvp-demo`。以下提交均为独立本地提交；未合并、推送或部署。代码和自动化通过不等于用户验收通过。

## 逐票完成证据

| Ticket | 本地提交 | 可核对的验收证据 |
| --- | --- | --- |
| [0023](../../tasks/0023-persist-concept-draft.md) | `3e17acf` | SQLite Concept 草稿与 Revision，隔离 API 持久化测试。 |
| [0024](../../tasks/0024-bilingual-browse-search.md) | `b647047`，修正 `0e1042e` | 双语目录、搜索及长页滚动，API 与浏览器验收。 |
| [0025](../../tasks/0025-localized-image-wiki.md) | `7bade73` | 分语言 WebP/Wiki 修改与原子保存测试。 |
| [0026](../../tasks/0026-recommendable-locale-readiness.md) | `b7f4803`，配图规则修订 `e8bcd79` | 推荐资格预览与降级提示；无上传配图仍可推荐，Web 显示默认配图，API 回归通过。 |
| [0027](../../tasks/0027-revision-history-conflicts.md) | `46b8be9` | 修订对比与过期编辑冲突恢复测试。 |
| [0028](../../tasks/0028-archive-restore-delete-concept.md) | `2b1ddc4` | 归档、恢复、引用保护删除及媒体清理测试。 |
| [0029](../../tasks/0029-real-registry-dashboard.md) | `36c1e04` | Dashboard 从同一 Registry 聚合目录及修订；P1 浏览器验收。 |
| [0031](../../tasks/0031-publish-finite-mvp-tickets.md) | `6dc9284` | 固定余下 0032–0040 的范围与依赖，未把整个 backlog 作为完成条件。 |
| [0032](../../tasks/0032-recommendation-contract-model-adapter.md) | `ad69b83` | 推荐契约、首次远端配置、DeepSeek 适配与真实合成烟测。 |
| [0033](../../tasks/0033-recommendation-api.md) | `bb88e62` | 正式推荐 API、同语言实时池；六条合成任务真实 DeepSeek API 烟测。 |
| [0034](../../tasks/0034-offline-eval-harness.md) | `cbccea4` | 正式 HTTP 评测入口、双语/NONE 合成案例与四指标报告；不记 Usage。0040 审查补充推荐时版本核对。 |
| [0035](../../tasks/0035-concept-relation-crud.md) | `738743e` | 五种 Relation、双语备注、引用约束；隔离 API 与浏览器新增/编辑/删除。 |
| [0036](../../tasks/0036-relation-ranking-signal.md) | `45832be` | 模型确认互补、同分且有 `often_used_with` 时稳定排序；正式 HTTP 假模型回归。 |
| [0037](../../tasks/0037-contextual-prompt-composer.md) | `56aa3e7` | 最新同语言 Concept 的上下文化 Prompt；原文 JSON 数据隔离和失败边界测试。 |
| [0038](../../tasks/0038-concept-discovery-skill.md) | `94876ca` | 主动调用 Skill、选择后 Compose、双语/NONE/无模型 CLI 路径；Skill 格式校验。 |
| [0039](../../tasks/0039-skill-feedback-usage.md) | `55a2d5b` | 真实 Skill 五类事件、版本和状态互斥、重启、Dashboard 聚合；Eval 隔离。 |
| [0040](../../tasks/0040-mvp-eval-acceptance.md) | **待完成** | 来源校验与本交接包已准备；80 条知识清单已审计但分类映射待定、尚未导入，维护者 Eval 案例、质量通过线和真实使用 Gate 尚缺。 |

各票的具体命令、结果与限制记在对应 task。2026-09-25 的最终本地检查：`npm run doctor` 通过（Node 24.18.0、Git 2.55.0、正确工作区），`npm run check` 通过（64/64 测试、75 个 Markdown 链接校验），`npm run demo:build` 通过，`git diff --check` 通过。维护者数据 Eval 未运行；合成案例只验证机制。

## 已验证的本地路径

- 独立 SQLite + 实际 `npm start`：`/` 与 `/api/dashboard` 返回 HTTP 200。没有模型配置时，Skill 明确返回 `model_unavailable`、提示运行 `npm run model:configure`；前后 Dashboard 的真实 run/event 均为 0。烟测数据库与本地服务已清理。
- 自动化隔离路径覆盖中文和英文：正式 API 推荐 → 用户选择 → 最新 Concept Compose → Agent 模拟应用成果 → `applied` 反馈 → Dashboard 聚合；也覆盖 NONE、用户不选、归档失效、无模型及 Eval 直调 API 不产生日志。人工验收仍需观察真实 Agent 回答是否应用了 Prompt。
- 0033 的真实 DeepSeek 烟测只使用合成输入，说明提供方链路可用；它不证明 0040 所需的真实任务质量。临时密钥没有写入仓库或本交接包。

## Gate 状态和未决事项

| PRD / 0040 项 | 当前可观察状态 | 判定 |
| --- | --- | --- |
| 30 个 cn/en 均可推荐 Concept | 用户提供 [80 条知识清单的审计结果](knowledge-list-audit-2026-09-25.md)与[映射工作表](knowledge-list-mapping-worksheet-2026-09-25.md)；当前受控分类不兼容，创建预览 0/80 通过，尚未导入。图片改为可选并显示默认配图。 | 未达；待分类映射与占位出处处理后在隔离库导入、核对。 |
| 50 条维护者标注、覆盖 cn/en、带来源的 Eval 案例 | 仓库仅有 [4 条明确标记 synthetic 的案例](../../eval/cases.synthetic.json)。 | 未达；不能用合成测试代替。 |
| 100 次真实主动 Skill 推荐 | 隔离工作区没有真实使用数据库；自动化和离线 Eval 不计入。 | 未达；需要实际用户调用积累。 |
| Top-1、Precision、NONE、过推及 Apply Rate 的通过线 | [PRD §40](../method-system-prd-v0.1.md#40-未决问题)仍列为待定。 | 需产品决策；未运行带人工标注的质量判定。 |
| 初始 Concept 的真实出处 | 原始 `daily-knowledge(1).md` 与知识清单声明的原始来源文件均未提供；清单至少 22 条有明确占位出处。 | 可先草稿；不能把占位语或结构化转译当原文。 |

30/50/100 是扩大目录和分发范围前的 Gate。当前可进入**技术路径的用户验收准备**，但 0040 的人工质量验收与扩大范围 Gate 尚未通过。

## 用户验收步骤

1. 在隔离工作区运行 `npm run doctor`、`npm run check`、`npm run demo:build`；审查 `git status --short --branch` 和本表逐票提交，不进行合并或部署。
2. 设置新的 `CONCEPT_DB_PATH`，运行 `npm start`；在 Web 建立至少一条中文、英文均可推荐的测试 Concept，检查草稿、配图、搜索、修订、归档与 Dashboard；再建立和修改 Relation，确认双语备注与方向。
3. 若要实际向 DeepSeek 发起推荐，在终端运行 `npm run model:configure`，阅读外发说明并输入由你控制的可用密钥；未选远端时验证 `model_unavailable`。不要将密钥放入仓库或验收报告。
4. 将 [项目 Skill](../../skills/concept-discovery/SKILL.md)按 [README](../../README.md#concept-discovery-skill) 链接到个人 skills 目录；分别用中文和英文明确调用，检查推荐、NONE、查看、忽略、选择、真实应用成果和 Dashboard 事件。普通任务不应自动触发。
5. 把至少 50 条经维护者标注的双语案例以 `dataset_kind: "maintainer"`、`source.kind/ref`、`locale`、`expected_ids` 提供在被忽略的私有路径；按 [评测契约](../../specs/eval-harness.md)运行 `npm run eval -- --cases PATH --baseUrl http://127.0.0.1:4173 --output PATH`，人工复核诊断/Why Now 的语言和相关性。给出数值通过线后，再判定各项指标；报告不得混入真实 Usage。
6. 用真实用户主动调用累计 100 次推荐，并补齐 30 个双语可推荐 Concept 后，按 PRD §35 判定扩大范围 Gate。用户验收结论由你给出。
