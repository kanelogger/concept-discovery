# Concept Discovery

认知自动补全工具：帮助人和 Agent 在当前情境下发现已有的概念、经验和方法。当前产品优先建设本地 Web 知识库，支持人工维护、搜索和关系探索；自动补全与 CLI / Skill / 对外 API / MCP 接入后续推进。

产品只维护两份文档：[需求文档](docs/需求文档.md)和[产品设计文档](docs/产品设计文档.md)。技术规格见[实现入口](specs/product-contract.md)，执行进度见[当前任务](workflow-state.json)和[待办](tasks/backlog.md)。

仓库已有 CRUD、Dashboard、关系、推荐与 Skill 等基础。新的 Web 阶段仍有内容字段、浏览和检索改造待实施；既有推荐质量 Gate 尚未完成。下文介绍当前运行方式，不代表新设计已经验收。

## Run locally

```sh
npm ci
npm start
```

Open `http://127.0.0.1:4173`. The service stores data in `.local/concept-discovery.sqlite` by default. Set `CONCEPT_DB_PATH` to another file for isolated demos or tests. The Web reads and writes the same Registry API used by the product tests.

```sh
npm run check
npm run demo:build
```

The editor accepts immutable lowercase slugs and at least one language name, then saves independent names, aliases, descriptions, tags, source text, WebP covers and optional HTTPS Wiki links per language. Save a draft before adding a cover. The Card First library searches only browsable content in the selected language; management shows drafts and missing fields. Archive, Dashboard, Recommendation API and Relation management are available locally.

## Concept Discovery Skill

The project Skill lives at [skills/concept-discovery/SKILL.md](skills/concept-discovery/SKILL.md). For Codex discovery after accepting this demo, link its folder into your personal skills directory, for example `ln -s "$PWD/skills/concept-discovery" "$HOME/.codex/skills/concept-discovery"` from this repository root. This demo does not alter global skills configuration. Invoke `/concept-discovery` or directly ask for applicable Concepts; ordinary tasks do not trigger it. The Skill calls the local recommendation API, shows the result, waits for your selection, then composes and applies the selected Concept to the current task. First remote use requires the interactive `npm run model:configure`; it explains which task content leaves this machine and records the choice in an ignored local `.env`.
