# 0039：记录 Skill 反馈与真实 Usage

Status: done

实施记录：2026-09-25 在独立 `codex/concept-mvp-demo` 工作区启动；前置 0038 已以 `94876ca` 提交。Usage 仅由 Skill 包装层写入，正式推荐 API 和离线 Eval 不写。一次主动调用生成 run ID 与不含原始文本的 task ID；Compose 只记准备状态，Agent 完成实际应用后才能报告 `applied`。

**What to build:** 只记录主动调用 Skill 的真实 `recommended`、`viewed`、`applied`、`ignored`、`not_useful` 事件，并在 Dashboard 展示真实聚合。

**Blocked by:** [0038：Concept Discovery Skill](0038-concept-discovery-skill.md).

## Acceptance criteria

- [x] 事件带任务、Concept ID/版本、`locale`、时间与可关联的推荐运行 ID；状态转移遵守 PRD 互斥规则，未执行 Prompt 不写 `applied`。
- [x] 评测入口不会写真实 Usage；Dashboard 只展示已采集的 Skill 事件和明确口径，Eval 指标独立。
- [x] 隔离服务与 Skill 测试覆盖推荐、查看、应用、忽略、无帮助、重启和无效转移；公共检查通过。

## 实施与证据

- [Usage 契约](../specs/skill-usage.md)定义匿名 task/run ID、Concept 推荐与应用版本、五种事件转移和 Dashboard 口径。Skill `recommend` 通过正式 API 后，才在同一 SQLite 事务中写 run、推荐事件与 Concept 引用；NONE 只写零结果 run。`compose` 只记准备状态；`feedback applied` 需要准备状态并由 Skill 指令限制在 Agent 产生实际成果之后。独立 Eval 只调用 API，没有 Usage 写入路径。
- `node --test tests/usage.test.mjs tests/skill-flow.test.mjs`：3/3 通过（2026-09-25）。覆盖两语言、推荐/查看/忽略/无帮助/应用、先忽略后查看无帮助、未 Compose 不可应用、互斥与重复事件拒绝、准备后不可忽略、版本与时间、重启持久化和真实引用阻止永久删除。Skill CLI 端到端测试确认 Compose 后应用数仍为零，反馈后增加；直接推荐 API 调用前后 Usage 聚合不变。
- Dashboard 从 `skill_runs` / `skill_usage_events` 聚合调用、NONE 和五类事件，含 cn/en 分组；Web 展示这些真实零值/计数与“Eval 不计入”的说明。`npm run check`：60/60 通过；`npm run demo:build` 与 Skill 格式校验通过。未写入用户实际 Registry 或私有任务文本。

## 未决与下一步

数据库只校验准备状态和事件转移，无法独立证明 Agent 在文字回答中真正用了 Prompt；Skill 明确要求完成成果后才报 `applied`，0040 人工验收需检查该行为。下一张依赖票据为 [0040 MVP Gate](0040-mvp-eval-acceptance.md)。
