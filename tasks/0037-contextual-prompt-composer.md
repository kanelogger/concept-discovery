# 0037：生成同语言上下文化 Prompt

Status: ready-for-agent

**What to build:** 用户选择 Concept 后，将该语言的 Agent 指引、转化目标和避免条件与当前 task/context/response 组合成仅供 Skill 执行的 Prompt。

**Blocked by:** [0036：Relation 排序信号](0036-relation-ranking-signal.md).

## Acceptance criteria

- [ ] Composer 读取最新 Concept 与显式 `locale`；缺少该语言资格、归档或不存在的 Concept 被拒绝，不借用另一语言内容。
- [ ] 原始 task/context/response 保留原文；不同任务生成不同 Prompt；Registry 不保存固定完整 Prompt，Web 不生成或展示。
- [ ] 测试覆盖 cn/en、同 Concept 不同上下文、恶意输入作为数据处理和失败边界；公共检查通过。
