# Concept Discovery

认知自动补全工具：帮助人和 Agent 在当前情境下发现已有的概念、经验和方法。当前产品优先建设本地 Web 知识库，支持人工维护、显式关键词搜索、DeepSeek 情境推荐和关系探索；更完整的自动补全与 CLI / Skill / 对外 API / MCP 接入后续推进。

产品只维护两份文档：[需求文档](docs/需求文档.md)和[产品设计文档](docs/产品设计文档.md)。技术规格见[实现入口](specs/product-contract.md)，执行进度见[当前任务](workflow-state.json)和[待办](tasks/backlog.md)。

仓库已有 CRUD、Dashboard、关系、推荐与 Skill 等基础。第一阶段 Web 字段、阅读编辑、情境关键词搜索与关系导航已实施，证据见 [0051](tasks/0051-web-acceptance.md)。维护者人工样本签收、30 天使用验证及既有推荐质量 Gate 尚未完成。

## Run locally

```sh
npm ci
npm start
```

Open `http://127.0.0.1:4173`. The service stores data in `.local/concept-discovery.sqlite` by default; normal use runs `npm start` without setting `CONCEPT_DB_PATH`. Set that variable only to use a separate database for an isolated demo or test. The Web reads and writes the same Registry API used by the product tests.

```sh
npm run check
npm run demo:build
```

The editor preserves bilingual content, sentence lists (triggers, questions, boundaries and examples), sources and multiple WebP images. The library defaults to Chinese browsable cards. Enter or Search submits keyword matching and opens a DeepSeek suggestion drawer for existing browsable Concepts; Clear and Reset return to unfiltered browsing. Draft/archived filters, conflict protection, related Concept navigation, addressable details and browser history are supported. Existing Recommendation, Skill and Usage behavior is preserved.

## Isolated sample library

```sh
npm run demo:prepare -- --db /tmp/concept-demo-new.sqlite
CONCEPT_DB_PATH=/tmp/concept-demo-new.sqlite npm start
```

The path must be new: existing databases and SQLite companion files are rejected. The versioned sample contains 12 bilingual Concepts and 12 explained relations; failure removes only the database created by this invocation. Sources and editorial notes are included in each Concept. This command never imports into the default library.

## Concept Discovery Skill

The project Skill lives at [skills/concept-discovery/SKILL.md](skills/concept-discovery/SKILL.md). For Codex discovery after accepting this demo, link its folder into your personal skills directory, for example `ln -s "$PWD/skills/concept-discovery" "$HOME/.codex/skills/concept-discovery"` from this repository root. This demo does not alter global skills configuration. Invoke `/concept-discovery` or directly ask for applicable Concepts; ordinary tasks do not trigger it. The Skill calls the local recommendation API, shows the result, waits for your selection, then composes and applies the selected Concept to the current task. First remote use requires the interactive `npm run model:configure`; it explains which task content leaves this machine and records the choice in an ignored local `.env`.
