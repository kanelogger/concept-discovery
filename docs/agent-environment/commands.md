# 开发命令

所有命令在仓库根目录执行，实际定义以 [package.json](../../package.json) 为准；[project.json](../../project.json) 只登记脚本名称。

| 命令 | 作用 | 网络与写入 |
| --- | --- | --- |
| `npm ci --ignore-scripts` | 按锁文件安装环境；当前零第三方依赖 | 当前无需下载依赖；可能写 npm 本地缓存 / node_modules，不运行生命周期脚本 |
| `npm run doctor` | 核实当前 Node、Git 和仓库根目录 | 离线、只读 |
| `npm run validate` | 校验清单、状态、必需路径及仓库 Markdown 本地链接 | 离线、只读 |
| `npm test` | 执行 Node 内置测试，覆盖环境工具故障路径 | 离线、隔离临时目录，自动清理 |
| `npm run check` | 依次执行 validate 和 test，任一失败返回非零 | 与上述两项相同 |

新机器先按 [.node-version](../../.node-version) 准备 Node 24，再运行安装、doctor 和 check。运行时检查失败应修正环境，不绕过 engines 限制。新增依赖时提交对应锁文件、明确安装网络需求并更新环境决策。

目前不存在 `dev`、`build`、`typecheck`、`e2e`、`method-system start` 命令，也没有监听端口。PRD 中的命令属于产品设想；首次实现时再注册真实入口和启停流程。

校验器检查仓库 Markdown 文件链接，包括 `.github` 等配置目录；跳过 Git 元数据、node_modules、`.local`、coverage、工具缓存和符号链接文件，具体排除项见 [校验器](../../scripts/validate.mjs)。检查目标引用时拒绝越出仓库的路径。它不发起 HTTP 请求，不验证标题锚点，不做语义或事实判断，也不证明产品正确。外链可用性、准入标准和任务结果由针对性审查负责。

验证结果记录到任务文件；本次执行证据见 [初始化任务](../../tasks/0001-bootstrap.md)。普通检查不修改任务状态、不自动提交或安装全局工具。
