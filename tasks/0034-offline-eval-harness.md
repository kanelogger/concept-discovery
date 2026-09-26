# 0034：建立离线推荐评测入口

Status: done

实施记录：2026-09-25 在独立 `codex/concept-mvp-demo` 工作区启动；前置 0033 已以 `bb88e62` 提交。50 条维护者标注数据留作 0040 的独立门槛，本票用清楚标记的合成样例验证评测机制。

**What to build:** 让开发用评测用例通过 0033 的正式 Recommendation API 运行，并输出可复核指标；评测调用不写真实 Usage 日志。

**Blocked by:** [0033：Recommendation API](0033-recommendation-api.md).

## Acceptance criteria

- [x] 每个案例显式指定 `locale`、输入、Expected Concept ID 或 NONE；固定双语与琐碎事实样例检验诊断、Why Now、卡片语言和 0–3 条边界。
- [x] 报告 Top-1 Hit、Recommendation Precision、NONE Precision 和 Over-recommendation；结果可追溯到案例与模型配置。
- [x] 同一请求经过正式推荐接口，但评测运行不写真实推荐/查看/应用事件；错误与配置缺失单独报告。
- [x] 运行隔离测试和公共检查；50 条维护者标注案例作为 0040 的独立数据门槛，不以合成样例冒充。

## 实施与证据

- [评测规格](../specs/eval-harness.md)定义案例格式、四项指标分母、错误排除规则与隐私边界；[四条示例](../eval/cases.synthetic.json)显式标为 `synthetic`，覆盖 `cn`/`en` 正例与琐碎事实 NONE。CLI 顺序请求正式 `/api/recommendations`，并用同一 Registry 的 `/api/concepts/:id` 核对卡片语言和版本。模型标识来自接口响应头，报告不复制原始任务或模型文案。
- `node --test tests/eval-harness.test.mjs`：5/5 通过；包括 CLI 实际生成 `0600` 报告、0/1/3 条输出与正确/错误指标计算、配置缺失单独报告、重复/语言错误拒绝、本机 origin 限制。隔离 SQLite 与假模型；测试未调用外网，临时数据已删除。
- `npm run check`：49/49 通过；`npm run demo:build` 与 `git diff --check` 通过。真实 DeepSeek 端到端合成烟测已在 0033 执行；本票不将四条合成案例冒充维护者人工标注质量数据。

## 未决与下一步

50 条维护者人工标注案例、其中真实使用日志来源，以及质量数值门槛仍属 0040 的独立数据/产品决策。下一张依赖票据为 [0035 Relation CRUD](0035-concept-relation-crud.md)。
