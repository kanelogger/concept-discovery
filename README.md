# Concept Discovery

<img src="web/favicon.svg" alt="" width="48" height="48">

Concept Discovery 是一个可自托管的中文个人知识卡网站。用 Markdown 整理概念、引用和原文，在网页里搜索、阅读和回想。仓库自带 279 张知识卡，可以从问题场景或学科进入，也可以沿图谱追到卡片中的引用原句。

## 快速开始

需要 Node.js 24.7 及以上的 24.x，以及已启动的 Docker 和 Compose。以下命令会克隆仓库并启动本机服务。

```sh
git clone https://github.com/kanelogger/concept-discovery.git
cd concept-discovery
npm ci
npm run deploy:init
npm start
```

应用就绪后，先预览仓库原稿的导入计划，再同步到本机知识库。首次导入完整知识库需要一些时间。如果同步中断，在同一个目录重跑 `npm run raw -- sync`，继续已保存的计划。

```sh
npm run raw -- sync --dry-run
npm run raw -- sync
```

打开[本机知识库](http://127.0.0.1:6806)。用 `npm stop` 停止服务，下一次用 `npm start` 继续。初始化只需执行一次，配置和数据存放在 `.local/knowledge/`。

## 阅读与维护

- **知识卡**支持搜索正文、按标签和更新日期筛选。有自测问题的卡片可以先试着回想，再展开参考正文。
- **场景**按问题和学科组织卡片。**图谱**展示卡片之间的实际引用，可直接打开引用原句。
- **资料**可查阅原文快照和历史整理提案。

网页和 CLI 提供只读查询。在 [`raw/`](raw/README.md) 编辑 Markdown 和附件，新卡可从[知识卡模板](templates/wiki/article.md)开始。编辑后运行 `npm run raw -- check`，再预览并同步。同步会报告目标库中的独立修改。[同步、归档与恢复](docs/agent-environment/commands.md#本地知识原稿) · [Agent 技能](skills/concept-discovery/SKILL.md)

## 开发与托管

项目图解见[技术架构](docs/architecture/technical-architecture.html)、[业务架构](docs/architecture/business-architecture.html)和[部署流程](docs/architecture/deployment-flow.html)。在浏览器中打开 HTML，可从右上角菜单导出 PNG 或 PDF。

本机检查使用 `npm run check`。默认服务绑定 `127.0.0.1`。远程访问需要配置 HTTPS 和站主账户。[命令参考](docs/agent-environment/commands.md) · [托管与备份](docs/reading-experience.md) · [产品契约](specs/product-contract.md)

软件采用 [MIT 许可证](LICENSE)。

<!-- kane-agent-harness:begin readme/readme -->
## 项目协作

从根 [AGENTS.md](AGENTS.md) 进入协作规则和任务记录。开发或运行检查前，从[环境清单](project.yml)核对工具、工作目录、前置条件与副作用，按其指向的真实配置执行。首次接入工具链时，把核实过的运行方式登记在对应的项目说明中。
<!-- kane-agent-harness:end readme/readme -->
