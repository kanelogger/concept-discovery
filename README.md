# Concept Discovery

<img src="web/favicon.svg" alt="Concept Discovery Logo" width="64" height="64">

个人知识卡网站：阅读、搜索与Markdown整理；明确要求时让Agent查询、应用或维护。只有明亮桌面界面，自测问题作为普通正文。没有复习、命令面板、厂商账号或同步订阅。

Logo「卡片与发现」的[双色主标](web/favicon.svg)用于登录页、页头和浏览器标签页。[单色 SVG](docs/brand/logo-mono.svg) · [反白 SVG](docs/brand/logo-white.svg) · [资产与使用说明](docs/brand/README.md)

## 启动

需要Node 24、Docker与Compose。

```sh
npm ci
npm run deploy:init
npm start
```

打开 http://127.0.0.1:6806 。访问码位于私有 `.local/knowledge/access-code`。初始化只接受新目录，已有配置和知识库拒绝覆盖。内核仅在容器网络运行，应用是唯一公开入口。

```sh
export CONCEPT_DISCOVERY_CONFIG="$PWD/.local/knowledge/client.json"
printf '{"query":"瓶颈","locale":"cn","limit":5}' | node bin/concept-discovery.mjs search
npm stop
```

CLI也可经npm pack安装后从任意目录使用。客户端配置指向应用地址和独立Agent令牌；远端要求HTTPS。服务端配置、工作区和操作备份含私密内容，不进入Git。

## 内容与维护

React 工作台使用 Ant Design 组件及图标，沿用纸感主题；Markdown编辑器懒加载，资源随应用本地构建。标题加正文即可，按需补来源、边界、例子、自测文字、图片和相关链接。轻量卡、普通笔记可网页编辑；早期固定字段卡可读可搜，由Agent按块维护。结构无法保真编辑时提前说明，原文保留。

[项目Skill](skills/concept-discovery/SKILL.md)仅显式调用。修改需要当前指纹和操作ID，备份后写入并读回；结果不明先查operation-status，恢复拒绝覆盖后续修改。初始化和旧库迁移改由本地管理入口 `bin/maintenance.mjs` 执行，不提供公网管理API。

## 检查与托管

`npm test`运行关键Node与工具回归；`npm run check:full -- --ego-run <id>`组合真实API/安装CLI、关键Playwright与ego-lite日常流程证据。临时库、容器和凭据结束清理；真实数据不参与测试。自托管HTTPS及备份说明见[阅读与使用](docs/reading-experience.md)。

[当前契约](specs/product-contract.md) · [命令](docs/agent-environment/commands.md) · [验证规则](rules/testing.md)。本机服务入口为 [6806](http://127.0.0.1:6806)。

开发初始化运行 `npm run dev:init`（等价于 `npm run deploy:init -- --development`），默认网页访问码为 `8869527`；隔离preview样本也使用该值。普通 `npm run deploy:init` 保持随机码，Agent/内核令牌始终随机；已有目录不会覆盖。
