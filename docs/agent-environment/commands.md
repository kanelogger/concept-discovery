# 当前命令

以package.json为准，Node24与锁文件依赖运行轻量检查；真实内核和浏览器测试另需Docker/Compose及Playwright Chromium。

| 命令 | 用途 |
| --- | --- |
| `npm run doctor` | 检查Node/Git/仓库环境 |
| `npm run validate` | 检查任务入口、引用和现行命令 |
| `npm run check` | 基础文档校验与Node回归 |
| `npm run build:web` | 构建本地前端资产 |
| `npm run test:integration` | 受影响的隔离真实内核/API/CLI保存读回 |
| `npm run test:browser` | 必要浏览器流程与故障回归 |
| `npm run deploy:init` | 初始化新私有目录，拒绝覆盖 |
| `npm start` / `npm stop` | 启停应用和内部内核 |
| `npm run dev:init` | 新开发目录初始化，独立凭据 |

没有强制全量或固定Ego证据协议。验证按[风险](../../rules/testing.md)选择。隔离测试只清理本轮资源，不访问正式知识库。

存储布局、内核或恢复格式改变时，另执行 `node tests/service/wiki-backup-restore.mjs` 冷备恢复检查；普通集成不运行它。失败隔离栈可用 `node tests/service/runtime.mjs cleanup <run-id>` 精确回收。

## 应用CLI

CONCEPT_DISCOVERY_CONFIG指向私有client.json，只含应用地址和独立Agent Token配置。CONCEPT_SERVICE_CONFIG是服务端配置；kernel.json只供本地维护，不交给日常CLI。

```sh
printf '%s\n' '{"query":"瓶颈","locale":"cn","limit":5}' | node bin/concept-discovery.mjs search
```

普通文档命令包括list/search/get/get-document/create/save-document/delete-document/update-block/append/recover/operation-status。保存需要固定op_id与当前revision/hash；结果未知先核对原回执。

source-import/sources-list/source-get保存及读取独立原文快照，wiki-draft从选定原文和可选单张卡生成草稿，不修改卡片。旧提案/事件仅供只读归档。详细JSON见[Wiki流程](../../skills/concept-discovery/references/wiki-workflows.md)。

## 模型设置

登录后通过右上角模型设置保存接口地址、模型、输出长度参数和密钥。配置保存在服务端私有目录，不向调用方回传密钥。已有配置继续用于单卡草稿；远端模型接口要求HTTPS，本机回环允许HTTP。

兼容服务需提供非流式Chat Completions和JSON对象模式。界面生成前显示目的地与所选范围；只发送原文及一张目标卡，超限拒绝。保留限时、取消与有限结构化输出恢复。日志不记录原文、问题、卡片正文或凭据。

初始化拒绝已有目录。普通访问码随机，开发初始化提供固定开发码；Agent及内核令牌始终独立随机。
