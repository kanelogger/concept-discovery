# Concept Discovery

<img src="web/favicon.svg" alt="Concept Discovery Logo" width="64" height="64">

个人桌面 LLM Wiki：**保存资料 → 生成一张草稿 → 编辑保存 → 阅读与回想**。

知识卡支持关键词、标签及更新时间筛选，正文用 Markdown 维护。AI 只生成草稿，用户审阅后通过普通编辑器保存；“我的理解”也是正文。保留原文快照与稳定引用，不做多卡审批、应用内问答、描述润色、复习排程或后台采集。

## 启动

需要 Node 24、Docker 与 Compose。

```sh
npm ci
npm run deploy:init
npm start
```

打开 http://127.0.0.1:6806 。访问码位于私有 `.local/knowledge/access-code`。初始化拒绝覆盖已有目录。应用是唯一公开入口，内部思源保存卡片和附件。

## 日常使用

在“资料与整理”粘贴或导入 Markdown/UTF-8 文本，保存原文后选择新卡或一张可编辑已有卡，显式发送到配置的模型生成草稿。草稿进入普通编辑器；已有正文保留，建议作为追加内容供人工修改。点击保存才写卡。模型设置显示实际目的地，凭据仅保存在服务端。

编辑器只提供 Markdown 源码、受限预览、基础格式与图片插入。问题可先回想再展开参考解释，写理解进入同一编辑器。早期固定字段卡和无法保真的原生结构保持可读，Agent仍可按块维护。旧来源链接、提案和记录可只读查看；已有正文、理解和快照不因精简而删除。

```sh
export CONCEPT_DISCOVERY_CONFIG="$PWD/.local/knowledge/client.json"
printf '{"query":"瓶颈","locale":"cn","limit":5}' | node bin/concept-discovery.mjs search
npm stop
```

[项目 Skill](skills/concept-discovery/SKILL.md)仅显式使用。网页和 CLI 共用应用接口，保存保留版本检查、op_id、备份、读回及未知操作核对。客户端只持有应用地址和独立 Agent Token。

## 开发与托管

`npm run check` 运行轻量文档及 Node 回归，`npm run build:web` 构建前端。按改动风险选择 `npm run test:integration` 或 `npm run test:browser`；不要求全量验收或固定浏览器证据协议。测试使用隔离样本，真实知识库不参与。

[产品契约](specs/product-contract.md) · [知识规则](specs/wiki-content.md) · [命令](docs/agent-environment/commands.md) · [验证规则](rules/testing.md) · [托管与备份](docs/reading-experience.md)

开发初始化 `npm run dev:init` 使用固定开发访问码；普通初始化使用随机访问码，Agent 与内核令牌始终独立随机。旧目录不会覆盖。
