# 0033：实现同语言 Recommendation API

Status: done

实施记录：2026-09-25 在独立 `codex/concept-mvp-demo` 工作区启动；前置 0032 已以 `ad69b83` 提交。接口从同一 Registry 读取指定语言的可推荐池，模型配置在每次请求时检查。

**What to build:** 从 P1 Registry 的指定语言可推荐池，结合真实模型诊断与排序输出最多三条带 Why Now 的 Concept；Web 仍不提供推荐输入或 Prompt。

**Blocked by:** [0032：推荐契约与模型接入](0032-recommendation-contract-model-adapter.md).

## Acceptance criteria

- [x] 请求显式指定 `cn`/`en`，只读取该语言 active 且 recommendable 的 Concept；给模型的紧凑卡片不含图片字节与完整 Agent 指引。
- [x] 输出默认 1 条、最多 3 条，可返回真实 NONE；诊断、理由、名称和卡片资料属于请求语言，禁止跨语言回退。
- [x] `avoid_when`、重复/高度重叠、低增益与互补性影响选择；无模型、模型错误和合法空推荐是不同结果。
- [x] 隔离 Registry 与假模型覆盖双语、0/1/3 条、排除与无模型边界；真实模型可用时做烟测；公共检查通过。

## 实施与证据

- `POST /api/recommendations` 接通实时 Registry 查询和每次请求的模型配置检查；请求与输出结构见 [推荐契约](../specs/recommendation-contract.md)。无模型/未选择远端不调用外部服务。Web 继续只做 CRUD 与 Dashboard。
- `node --test tests/recommendation-api.test.mjs`：隔离 SQLite 与假模型的 HTTP 测试通过，覆盖中英资格池、草稿和归档排除、候选卡隐私、默认 1/最多 3、正常 NONE、无模型、上游失败及无效 ID。结构重复 ID 由 0032 契约测试拒绝。
- `npm run model:api-smoke`：用户的临时 key 经隐藏终端输入，六条合成任务通过正式 HTTP API 调用 `deepseek-flash`。适用任务推荐 1 条；低增益与命中 `avoid_when` 的任务返回 NONE；两个高度重叠的失败视角只输出 1 条；互补任务输出机会成本和 1 条失败视角；英文任务输出英文可推荐 Concept。密钥不落盘；烟测临时数据库已删除。此样本不能替代 0034 的离线评测。
- `npm run check`：44/44 通过；`npm run demo:build` 和 `git diff --check` 通过。正式 API 返回的 `card` 只含请求语言的描述、标签、图片哈希与共用类型，不传另一语言内容或 Agent 指引。

## 未决与下一步

尚无人工标注评测集，模型语义质量只由上述合成烟测提供有限证据。0034 建立独立 Eval Harness，继续核查更多中英、NONE、互补和误荐案例；真实使用事件留待 P5。
