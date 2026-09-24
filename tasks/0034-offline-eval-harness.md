# 0034：建立离线推荐评测入口

Status: ready-for-agent

**What to build:** 让开发用评测用例通过 0033 的正式 Recommendation API 运行，并输出可复核指标；评测调用不写真实 Usage 日志。

**Blocked by:** [0033：Recommendation API](0033-recommendation-api.md).

## Acceptance criteria

- [ ] 每个案例显式指定 `locale`、输入、Expected Concept ID 或 NONE；固定双语与琐碎事实样例检验诊断、Why Now、卡片语言和 0–3 条边界。
- [ ] 报告 Top-1 Hit、Recommendation Precision、NONE Precision 和 Over-recommendation；结果可追溯到案例与模型配置。
- [ ] 同一请求经过正式推荐接口，但评测运行不写真实推荐/查看/应用事件；错误与配置缺失单独报告。
- [ ] 运行隔离测试和公共检查；50 条维护者标注案例作为 0040 的独立数据门槛，不以合成样例冒充。
