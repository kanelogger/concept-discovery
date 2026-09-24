# 0040：运行 MVP 离线评测并整理验收包

Status: ready-for-agent

**What to build:** 运行已标注的双语 Eval、完整本地路径和项目检查，汇总 0023–0029、0031–0040 的逐票提交、验收证据、已知限制与用户操作步骤。

**Blocked by:** [0039：Skill 反馈与 Usage](0039-skill-feedback-usage.md).

## Acceptance criteria

- [ ] Eval 案例有维护者标注的 Expected、`locale` 与来源；报告命中、精准、NONE 与过推结果，不把合成数据算作真实使用。
- [ ] 从本地服务到 Skill 推荐、用户选择、Prompt 执行、反馈 Dashboard 的双语路径和无模型分支可复现；`npm run check`、构建和产品验收通过。
- [ ] 汇总有限范围 `0023–0029 + 0031–0040` 的逐票提交、通过/未运行检查、未决问题、风险和最终用户验收步骤；工作树可审查，不合并或部署。
- [ ] PRD 的 30 个双语齐备 Concept、50 条人工案例、100 次真实主动调用及数值通过线属于扩大范围前的 Gate；缺少时明确标未达，不伪造为本轮代码通过。
