# 当前命令

命令以 package.json 为准。快速 Node 检查只需 Node24 与锁文件依赖；真实集成和浏览器需要 Docker/Compose，关键浏览器用例需要 Playwright Chromium，日常流程需要 ego-lite。

| 命令 | 用途 |
| --- | --- |
| `npm run doctor` | 核对 Node/Git/仓库根 |
| `npm run validate` | 项目/状态、引用、现行文档中的 npm 脚本引用 |
| `npm run check` | 文档检查和关键 Node/工具测试 |
| `npm run deploy:init` | 初始化独立私有配置，拒绝覆盖 |
| `npm start` / `npm stop` | 启停应用及内部内核，应用回环6806 |
| `npm run build:web` | esbuild 打包 CSS 与共享 React/懒编辑器 JS，生成发布清单 |
| `npm test` | 关键 Node/工具永久回归 |
| `npm run test:integration` | 独立真实 API、安装 CLI、恢复/重启与完整资产校验 |
| `npm run test:browser` | 五组竞态/故障注入 Playwright |
| `npm run test:ego -- start` | 启动日常真实用户验收栈，输出 run ID/地址/凭据路径 |
| `npm run test:ego -- record --run <id> --checkpoint <name> --input <json>` | 记录真实观察与截图/读回 |
| `npm run test:ego -- cleanup --run <id> --browser-finished <json>` | 精确回收指定测试栈，保留证据 |
| `npm run test:ego -- verify --run <id>` | 核对指定证据、输入及清理 |
| `npm run check:full -- --ego-run <id>` | 全部自动检查与指定 ego 证据门禁 |

客户端配置由 CONCEPT_DISCOVERY_CONFIG 指向私有 client.json；服务使用 CONCEPT_SERVICE_CONFIG。kernel.json 只交给本地维护入口 bin/maintenance.mjs。初始化/迁移不开放 HTTP，迁移源只读。

测试只使用独立样本栈，按 run ID 持久化归属；证据在样本工作区外。完整入口拒绝缩范围和暂留开关，缺失/陈旧/未清理的 ego 证据返回非零。受限环境需按当前会话申请本机端口和 Docker 权限；项目文件不授予机器权限。

浏览器空间结束回执由真实 `await task.finish({keep:[]})` 成功后保存为 `{spaceId,finishedAt,result:"resolved"}`；通过 cleanup 的 `--browser-finished` 导入。完整门禁核对空间归属、结束时间及回执摘要；未提供回执仍可清理失败候选，但不能通过交付门禁。

结束浏览器空间前运行 `npm run test:ego -- status --run <id> --require-complete`，必须确认恰好六个检查点通过；独立CLI读回与检查点记录由同一run原子更新协议合并，保留原始失败与恢复信息。

开发初始化运行 `npm run dev:init`（等价于 `npm run deploy:init -- --development`），默认网页访问码为 `8869527`；隔离preview样本也使用该值。普通 `npm run deploy:init` 保持随机码，Agent/内核令牌始终随机；已有目录不会覆盖。

## 启用按问题找卡

登录网页后，在右上角打开「模型设置」，填写 API 前缀、模型名、输出长度参数和 API 密钥。保存后的配置用于下一次分析，并保存在服务端私有配置目录。API 地址不变时，密钥留空可沿用当前密钥。网页保存的设置优先于以下文件配置。


在私有 `service.json` 加入可选的 `llm` 对象，并在同一私有配置目录放置仅服务可读的密钥文件。下面的地址和模型名是格式示例。

```json
{
  "llm": {
    "baseUrl": "https://model.example/v1",
    "model": "your-model",
    "apiKeyFile": "model-api-key",
    "maxTokenField": "max_completion_tokens"
  }
}
```

baseUrl 为兼容服务的 API 前缀，应用会追加 `/chat/completions`。服务需支持非流式 Chat Completions 和 JSON 对象模式。服务若使用 max_tokens 参数，将 maxTokenField 设为 `max_tokens`。apiKeyFile 相对 service.json 解析。远程地址使用 HTTPS。配置完成后重启应用服务，在知识卡列表切换到“按问题找卡”。普通搜索在缺少或关闭模型配置时可用。

DeepSeek 的已验收配置为 baseUrl 使用 `https://api.deepseek.com`，model 使用 `deepseek-flash`，maxTokenField 使用 `max_tokens`。密钥仍通过 apiKeyFile 读取。[DeepSeek JSON Output 文档](https://api-docs.deepseek.com/zh-cn/guides/json_mode/)

调用时，模型服务会收到问题、最多200个标题且合计不超过12000字符的卡片目录，以及受限知识片段。应用只在当前标签页内存保留回答。CLI 通过现有 client.json 与 Agent 令牌调用，返回含引用的 JSON。

```sh
printf '%s\n' '{"question":"项目上线前怎样排查失败风险？"}' | concept-discovery ask
```

status 为 answered、insufficient 或 no_match。应用最长处理 90 秒，CLI 等待上限为 100 秒。直接连接官方DeepSeek端点的受支持模型会显式关闭默认思考模式，使结构化输出使用有限预算。每个阶段对空白、截断、无效JSON及结构错误最多恢复一次；截断时预算最多翻倍至8192，仍共用原90秒期限。模型拒绝不重试。无效引用或回答字段校验失败的候选先被丢弃，只允许用原始合法证据重新生成一次；再次失败仍返回错误，不能放松校验或补造引用。诊断日志只保留阶段、尝试次数、预算、结束类型和校验类别，不含用户问题、卡片内容或凭据。
