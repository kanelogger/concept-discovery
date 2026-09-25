# 0040：运行 MVP 离线评测并整理验收包

Status: needs-info

实施记录：2026-09-25 在独立 `codex/concept-mvp-demo` 工作区启动；前置 0039 已以 `55a2d5b` 提交。当前工作区只有明确标记的四条 synthetic 案例，未提供维护者标注数据、30 个双语可推荐 Concept 或 100 次真实主动调用；先完成可独立验证的验收路径、数据来源校验与逐票交接，外部 Gate 保持未达。

**What to build:** 运行已标注的双语 Eval、完整本地路径和项目检查，汇总 0023–0029、0031–0040 的逐票提交、验收证据、已知限制与用户操作步骤。

**Blocked by:** [0039：Skill 反馈与 Usage](0039-skill-feedback-usage.md).

## Acceptance criteria

- [ ] Eval 案例有维护者标注的 Expected、`locale` 与来源；报告命中、精准、NONE 与过推结果，不把合成数据算作真实使用。
- [ ] 从本地服务到 Skill 推荐、用户选择、Prompt 执行、反馈 Dashboard 的双语路径和无模型分支可复现；`npm run check`、构建和产品验收通过。
- [ ] 汇总有限范围 `0023–0029 + 0031–0040` 的逐票提交、通过/未运行检查、未决问题、风险和最终用户验收步骤；工作树可审查，不合并或部署。
- [x] PRD 的 30 个双语齐备 Concept、50 条人工案例、100 次真实主动调用及数值通过线属于扩大范围前的 Gate；缺少时明确标未达，不伪造为本轮代码通过。

## 已完成的独立准备与证据

- [验收交接包](../docs/acceptance/mvp-handoff-2026-09-25.md)汇总固定票号范围、0023–0039 的独立提交、检查结果、真实/合成数据边界、Gate 缺口与用户验收步骤；未合并或部署。
- `maintainer` 数据集现在强制每条案例具备 `source.kind` 和不含原文的 `source.ref`；评测报告保留来源标识。`node --test tests/eval-harness.test.mjs tests/skill-flow.test.mjs`：8/8 通过，覆盖来源格式与中文/英文 API → 选择 → Compose → 模拟 Agent 成果 → 反馈 Dashboard。自动化不能代替真实用户评判回答是否确实用了 Prompt。
- 以独立 `/private/tmp/concept-mvp-gate-smoke.sqlite` 和端口 4180 运行实际 `npm start`：Web `/` 与 `/api/dashboard` HTTP 200；未配置模型的 Skill 返回 `model_unavailable` 和配置提示；前后 Usage run/event 为 0。服务已关闭，隔离数据库已清理。
- `npm run doctor`、`npm run check`（61/61、73 个 Markdown 文件）、`npm run demo:build`、`git diff --check` 通过（2026-09-25）。本轮未运行 50 条维护者案例的 Eval，未验证真实应用率或数值通过线。

## 缺失资源和判定

仓库只有 [4 条 synthetic 案例](../eval/cases.synthetic.json)，独立工作区没有正式目录或真实 Usage 数据库。维护者需提供至少 50 条含 cn/en、Expected 和 `source.kind/ref` 的标注案例及四项推荐指标的数值通过线；若要判定 Apply Rate 还需定义其分母和通过线。30 个双语可推荐 Concept 与 100 次真实主动调用是 PRD §35 的扩大范围 Gate，当前明确为未达。收到案例与决定后，按 [评测契约](../specs/eval-harness.md)在私有路径运行正式 API Eval，复核语言与 Why Now，更新本票证据并再提交。人工用户验收尚未开始。
