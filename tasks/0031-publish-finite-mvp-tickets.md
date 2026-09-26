# 0031：限定 P2–P5 实施票据与依赖

Status: done

**What to build:** 将 MVP 剩余工作限定为 0032–0040 九张纵向 tickets，注明依赖、公开验收与真正需要产品选择或外部资源的节点；已完成的 P1 范围固定为 0023–0029。`0030` 是先前发布 P1 票据的任务，不混入新实施范围。

**Blocked by:** [0029：真实目录 Dashboard](0029-real-registry-dashboard.md).

## Acceptance criteria

- [x] 0032–0040 分别覆盖推荐契约/模型、正式推荐接口、离线 Eval 入口、Relation CRUD、Relation 排序信号、Prompt Composer、主动调用 Skill、真实反馈事件、最终技术验收；各票据有明确依赖与可观察结果。
- [x] Backlog 和当前状态明确固定范围 `0023–0029 + 0031–0040`，不把持续增长的 backlog 或 MVP Gate 的真实使用样本误当本轮代码完成条件。
- [x] 将模型接入选择、远端上下文边界、50 条人工标注案例与真实调用样本等未决资源标出，不编造已有模型或用例。
- [x] 执行 `npm run validate`，形成仅包含本票文档和状态的独立本地提交。

## 实施与证据

- 0032–0040 九张 ticket 形成严格顺序：P2 推荐契约/模型 → API → Eval；P3 Relation CRUD → 排序信号；P4 Composer → Skill；P5 真实 Usage → 最终技术验收。每张 ticket 的外部行为、检查和依赖在对应文件中列出。
- 本轮固定范围显式写为 `0023–0029 + 0031–0040`；MVP Gate 的 30 个双语 Concept、50 条人工标注 Eval Case、100 次真实主动调用及数值通过线保留为扩大范围前的证据目标，缺少时如实报告。
- P2 模型提供方仍待用户选择；当前命令环境未发现 `ollama`。已向用户请求具体模型名称与端点或远端提供方。在选择前不提交真实上下文到任何模型。
- 2026-09-25：`npm run validate` 通过，覆盖 65 个 Markdown 文件；`git diff --check` 通过。本票只更新任务规划和环境事实，不增加镜像测试。

## 未决与下一步

0032 从 [推荐契约与模型适配](0032-recommendation-contract-model-adapter.md)启动。P2 的真实 LLM 接入待用户明确选择；无可用模型时不得把配置缺失表示为空推荐。0034/0040 的人工案例和真实使用样本须从可靠来源取得，未取得时标明缺口。
