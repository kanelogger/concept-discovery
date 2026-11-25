# 原始资料与历史记录

用 `sources-list` 传入 `{}` 列出快照，再用 `source-get` 传入 `{"id":"快照ID"}` 核对整篇原文、作者、出处和版本。网页中的 `/wiki?source=<快照ID>` 可直达相同的原文。来源地址只提供出处线索，引用应与实际原文核对。

`wiki-card` 按卡片 ID 返回自测问题。`wiki-proposals` 列出旧整理提案，`wiki-proposal` 按提案 ID 查看条目和引用，`wiki-events` 读取归档知识事件。保留原文、人的理解与归档记录各自的出处。

用户要求添加原始资料时，将实际提供的文件放入对应卡片的 `assets/`，在 `article.md` 的 YAML `sources` 列出相对路径。尚未关联卡片的资料可放在 `raw/未归档/<英文标识>/`，按 `kind: source` 的原稿格式填写。用本地原稿同步保存新快照，保留旧链接可查。[原稿格式](../../../raw/README.md)

只在需要核对或恢复某一次已有操作时，从仓库根目录用 `npm run raw -- status <操作ID>` 查原回执。确认要恢复时，用 `npm run raw -- recover <操作ID> --revision <写后修订或哈希>` 在同一实例执行受保护恢复。原稿同步中断、冻结计划和冲突处理见[本地命令说明](../../../docs/agent-environment/commands.md#本地知识原稿)。
