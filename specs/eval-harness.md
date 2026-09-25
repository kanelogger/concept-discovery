# 离线推荐评测入口（0034）

状态：已实现开发用评测机制；[50 条维护者人工标注案例](../tasks/0040-mvp-eval-acceptance.md)尚未提供，合成示例不可充当质量验收数据。来源为 [PRD §32](../docs/method-system-prd-v0.1.md#32-eval)与 [推荐契约](recommendation-contract.md)。

## 运行方式与数据边界

先启动本地服务，再运行 `npm run eval -- --cases PATH --baseUrl http://127.0.0.1:4173 --output PATH`。默认案例是 [四条合成示例](../eval/cases.synthetic.json)，默认报告写入被忽略的 `.local/eval-report.json`，权限 `0600`。实际案例可能包含私有任务文本，建议放在被忽略的 `.local` 中。评测器只接受本地 HTTP origin，按案例顺序 `POST /api/recommendations`，再以 `GET /api/concepts/:id` 核对推荐卡的语言与版本；不写推荐、查看、应用或忽略等真实 Usage 事件。服务若已配置远端 DeepSeek，案例文本会按用户此前的明确选择发往该模型。

案例 JSON 使用 `schema_version: 1`、`dataset_kind: "synthetic" | "maintainer"` 和非空 `cases`。每个案例须有唯一 `id`、显式 `locale: "cn" | "en"`、`input` 中的任务/可选上下文以及维护者标注的 `expected_ids`：空数组表示 NONE；最多 3 个跨语言共用 Concept ID。`input` 不再写 `locale`，防止与案例语言冲突。`maintainer` 案例还须有 `source: { "kind": "maintainer_authored" | "real_task_anonymized", "ref": "不含原文的来源编号" }`；报告保留该来源标识以追溯标注。不要把真实对话、姓名或 URL 填入 `ref`。

报告只含案例 ID、语言、Expected/输出 ID、Concept 版本、非敏感模型标识、HTTP 错误码和结构检查结果，不复制原始任务、诊断或 Why Now 文本。模型标识来自正式接口响应头；若假适配器未提供标识，报告明确写 `unspecified`。`diagnosis_present` 和 `why_now_present` 只验证文本存在，`card_locale_match` 对照 Registry 的指定语言字段；诊断与理由是否真正使用该语言、是否有帮助，仍需人工复核。

## 指标口径

四项指标只计算 HTTP 200 且结构有效的案例；模型缺失、网络错误和非法响应逐案列为错误，并在报告中单列 `error_count`，不静默当作 NONE 或计入指标分母。分母为 0 时 `value: null`，不能解释为 0 分。

| 指标 | 分子 / 分母 |
| --- | --- |
| `top1_hit` | Expected 非空且首条输出 ID 属于 Expected 的案例数 / Expected 非空的已评案例数 |
| `recommendation_precision` | 输出 ID 属于该案例 Expected 的总条数 / 所有输出条数 |
| `none_precision` | 输出空列表且 Expected 也为空的案例数 / 所有输出空列表的案例数 |
| `over_recommendation` | 至少有一条输出 ID 不在 Expected 中的案例数 / 全部已评案例数 |

这些数值不包含 Apply、Ignore、Not Useful 等真实使用指标。0034 的合成样例验证评测器和接口连通性，不建立质量通过线；维护者标注的 50 条案例、真实调用样本和最终门槛留待 0040。
