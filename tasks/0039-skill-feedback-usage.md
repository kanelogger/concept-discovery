# 0039：记录 Skill 反馈与真实 Usage

Status: ready-for-agent

**What to build:** 只记录主动调用 Skill 的真实 `recommended`、`viewed`、`applied`、`ignored`、`not_useful` 事件，并在 Dashboard 展示真实聚合。

**Blocked by:** [0038：Concept Discovery Skill](0038-concept-discovery-skill.md).

## Acceptance criteria

- [ ] 事件带任务、Concept ID/版本、`locale`、时间与可关联的推荐运行 ID；状态转移遵守 PRD 互斥规则，未执行 Prompt 不写 `applied`。
- [ ] 评测入口不会写真实 Usage；Dashboard 只展示已采集的 Skill 事件和明确口径，Eval 指标独立。
- [ ] 隔离服务与 Skill 测试覆盖推荐、查看、应用、忽略、无帮助、重启和无效转移；公共检查通过。
