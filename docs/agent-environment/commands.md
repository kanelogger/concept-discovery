# 开发命令

所有命令在仓库根目录执行，实际定义以 [package.json](../../package.json) 为准；[project.json](../../project.json) 只登记脚本名称。

| 命令 | 作用 | 网络与写入 |
| --- | --- | --- |
| `npm ci` | 按锁文件安装 React/Vite 等依赖；缓存齐全时可用 `npm ci --offline` | 可能访问包源，写 `node_modules` 和 npm 缓存 |
| `npm run doctor` | 核实当前 Node、Git 和仓库根目录 | 离线、只读 |
| `npm run validate` | 校验清单、状态、必需路径及仓库 Markdown 本地链接 | 离线、只读 |
| `npm test` | 执行环境与产品 API 测试；产品测试在隔离临时目录启动本地服务并自动清理 | 离线、临时目录、本地回环端口 |
| `npm run check` | 依次执行 validate 和 test，任一失败返回非零 | 与上述两项相同 |
| `npm run test:product` | 单独执行 Registry/API 持久化测试 | 离线、临时目录、本地回环端口 |
| `npm run demo:build` | TypeScript 检查并打包正式 Web 入口 | 离线，写 `dist` |
| `npm start` | 在 127.0.0.1:4173 启动本地 API 与 Web；`CONCEPT_DB_PATH` 可指定隔离数据库 | 本地回环端口，写 `.local` 或指定路径 |
| `npm run model:configure` | 首次选择远端 DeepSeek 并隐藏输入密钥，保存到被忽略的 `.env` | 本地配置写入；本命令不调用外网 |
| `npm run model:smoke` | 用合成任务直连 `deepseek-flash` 验证适配器；密钥隐藏输入且不保存 | 向 DeepSeek API 发送合成文本 |
| `npm run model:api-smoke` | 用临时 SQLite 与本地 HTTP API 发起六条中英合成推荐任务；密钥隐藏输入且不保存 | 本地回环端口、向 DeepSeek API 发送合成文本 |
| `npm run eval -- --cases PATH --baseUrl http://127.0.0.1:4173 --output PATH` | 经正式 API 顺序运行离线案例，输出不含原始任务文本的逐案例与指标报告；默认数据是合成示例 | 调用本地服务；若已选择远端模型，本地服务会向其发送案例文本；报告写入被忽略的 `.local` |
| `node scripts/skill-discovery.mjs recommend < input.json` | 用户明确触发 Skill 后，经本地正式推荐 API 获取 0–3 项；stdin JSON 包含 `invocation` 和显式语言的 `request` | 本地回环端口；已选择远端时会向提供方发送请求内容；不写日志 |
| `node scripts/skill-discovery.mjs compose < input.json` | 用户选定已展示的 Concept 后，从同一 Registry 读取最新版生成 Prompt，供 Agent 实际应用 | 本地数据库只读；Prompt 输出到 stdout，不保存 |

新机器先按 [.node-version](../../.node-version) 准备 Node 24，再运行安装、doctor 和 check。运行时检查失败应修正环境，不绕过 engines 限制。新增依赖时提交对应锁文件、明确安装网络需求并更新环境决策。

当前产品启动命令为 `npm start`，`npm run demo` 是同一入口的别名。默认端口可用 `PORT` 覆盖；停止服务用 Ctrl-C。

校验器检查仓库 Markdown 文件链接，包括 `.github` 等配置目录；跳过 Git 元数据、node_modules、`.local`、coverage、工具缓存、Git 忽略的 `private-*` 参考目录/Markdown 文件和符号链接文件，具体排除项见 [校验器](../../scripts/validate.mjs)。检查目标引用时拒绝越出仓库的路径。它不发起 HTTP 请求，不验证标题锚点，不做语义或事实判断，也不证明产品正确。外链可用性、准入标准和任务结果由针对性审查负责。

验证结果记录到任务文件；本次执行证据见 [初始化任务](../../tasks/0001-bootstrap.md)。普通检查不修改任务状态、不自动提交或安装全局工具。
