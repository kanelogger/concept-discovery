# Recommendation API 契约

状态：0032–0034 已实现契约、DeepSeek 适配器、正式 HTTP 接口和离线评测；0036 接入 Relation 的同分排序。模型决定见 [ADR 0003](../docs/adr/0003-deepseek-model-adapter.md)。来源为 PRD §20–§25（历史文件 `docs/method-system-prd-v0.1.md`，见下方来源说明）与 [产品契约](product-contract.md)。

## 请求与资格

请求包含非空 `task`、显式 `locale: "cn" | "en"`，可附带 `context`、`response`、`user_intent` 文本和 `limit`。缺失的上下文文本按空串处理；`limit` 默认为 1，只接受 1–3。推荐可以返回 0 条，不能将模型缺失表示为 0 条推荐。

候选仅来自同一 Registry 中 `active` 且指定语言 `recommendable` 的 Concept。给模型的紧凑卡片包含 `id`、本语言名称与一句描述、`trigger`、`avoid_when`、共用的 `domains`、`intents` 和已填写的两个类型；不传图片字节、另一语言内容、完整 `agent_instruction`。候选生成与实际模型调用由 0033 实现。

## 模型判定与公开输出

模型判定只接收 `diagnosis: string[]` 与 `recommendations: { id, reason, confidence, complementary_to? }[]`。`complementary_to` 是可选的先前入选 Concept ID 数组，用于明确确认互补关系；公开结果不暴露这个内部字段。每个 ID 必须属于本次候选且不重复，理由非空，`confidence` 为 0–1 的有限数。推荐条数不超过请求 `limit`，最多 3。模型提供的名称即使存在也不得用于公开输出。

服务端根据请求语言的 Registry 数据填入公开的 `name`、当前 `concept_version` 与展示用 `card`（本语言 `description`、`tags`、首张图的可空 `cover_image` 哈希以及共用类型），并回显请求 `locale`。Registry 的 `cover_images` 保存完整有序图集；推荐卡片继续以 `cover_image` 暴露首图兼容字段。首图为空时客户端显示默认配图，不借用另一语言图片：

```json
{
  "locale": "cn",
  "diagnosis": ["当前决策缺少未来选择比较"],
  "recommendations": [
    { "id": "opportunity-cost", "concept_version": 3, "name": "机会成本", "reason": "需要比较未来替代方案", "confidence": 0.81,
      "card": { "description": "比较选择时放弃的机会", "tags": ["决策"], "cover_image": "sha256-hash", "interaction_type": "lens", "epistemic_type": "principle" } }
  ]
}
```

正常 NONE 使用 `recommendations: []`。诊断与 Why Now 的语义质量、`avoid_when`、互补性及低增益判断由 0033 的提示与 0034 的离线案例验收，单靠结构校验不能证明。

## Relation 同分排序（0036）

服务端只从当次同语言 active、recommendable 候选池读取关系。模型先独立决定 0–3 条及置信度；Relation 不加入候选、不增加推荐数，也不覆盖禁用条件判断。仅当某个已入选项的 `complementary_to` 指向当前同分组之前的已入选项、两者在 Registry 中有 `often_used_with` 关系时，才在该同分组内优先展示该项。首项和不同置信度的先后次序固定；同分组成员互指、没有有效关系或模型未确认互补时保持原顺序。不叠加数值权重。

`extends` 与 `part_of` 保留存储方向，不自动解释为互补，也不改变排序。关系事实与模型互补判断须同时成立；模型仍可能产生语义误判，最终质量由离线和真实使用数据评估。

## 模型与数据边界

本地模型优先；当前未配置本地模型，用户已选 DeepSeek 远端。没有可用模型时返回 `503 model_unavailable`，本地模型被选但没有适配器返回 `503 local_model_unavailable`。首次远端调用前须运行 `npm run model:configure`，阅读数据外发说明并输入 `deepseek`、密钥；选择记录于被忽略的 `.env`。未选择远端返回 `503 model_consent_required`。适配器异常返回 `502 model_failed`，超时返回 `504 model_timeout`，错误响应不泄露提供方内部详情；超时会中止调用信号。开发用评测入口和 Web 均不以模型缺失伪造空推荐；0033 阶段的 Web 不提供推荐输入、Playground 或 Prompt 展示；0054 增加知识库搜索推荐抽屉。

提供方无关的 `runRecommendation` 接受注入的 `adapter.decide({ request, candidates }, { signal })`，默认超时 30 秒，调用者可在服务端覆盖。适配器只收到请求和同语言紧凑卡片，返回值仍受结果契约校验。DeepSeek 适配器使用 `deepseek-flash` 的 JSON Output；模型只返回诊断与候选 ID、理由、置信度，公开名称由 Registry 填入。真实模型调用由 0033 的推荐接口接线。

## 正式 HTTP 接口（0033）

`POST /api/recommendations` 接受上述请求 JSON，最大请求体 64 KiB。服务端每次从 P1 的同一 SQLite Registry 读取指定语言的 active、recommendable Concept，实时检查模型配置，并返回上述公开输出；不写真实 Usage 事件。首次配置后无需重启本地服务。

成功响应的 `X-Model-Provider` 与 `X-Model-Name` 只给出非敏感模型标识，供离线评测追溯；不包含 API key。

无效请求返回 `400 invalid_recommendation_request`，模型配置/同意缺失返回相应 `503`，模型超时返回 `504 model_timeout`，上游或模型输出错误返回 `502`。正常空推荐返回 HTTP 200 与 `recommendations: []`。Web 知识库不调用此 Agent 推荐接口；0054 的浏览推荐使用单独的 `/api/discover`。Web 仍不展示 Prompt。双语隔离由 Registry 资格、候选卡裁剪和结果 ID 校验共同保证；诊断与 Why Now 的实际语言和相关性仍由模型及 0034 离线案例检验。

> 历史来源说明：旧产品材料已在 0045 合并删除；原文恢复方式见[文档收敛决策](../docs/adr/0004-product-doc-consolidation.md)。本文保留当时的任务或接口记录，不作为当前产品路线图。

## 知识库浏览推荐（0054）

`POST /api/discover` 接受同一请求结构，Web 在用户显式提交非空搜索时传入搜索词作为 `task`，固定请求最多三条。候选来自当前语言 active 且 `browsable` 的 Concept，因而普通知识卡片不需要 Agent 指令。模型只接收同语言紧凑卡片，不读取草稿、归档或另一语言内容；ID、理由与结果结构沿用上面的服务端校验。没有候选直接返回空推荐，不调用模型；模型失败返回原有错误，不影响独立的关键词结果。原 `POST /api/recommendations` 仍只接收 `recommendable` 候选，Skill 与正式 Usage 规则不变。
