# 当前环境入口

先读根[执行环境声明](project.yml)，命令和服务以其引用的实际配置为准；产品状态仍见[项目清单](project.json)。清单声明能力需求，不授予权限，亦不代表服务当前已启动。

使用 Node 24.7 及以上的 24.x、Docker Compose 和固定思源 3.8.9 内核。独立应用提供只读网页和 Agent 接口，默认绑定回环端口 6806。本地维护命令在选定实例中同步 `raw/`。启动与维护命令见[命令说明](docs/agent-environment/commands.md)。

正式配置和工作区默认在 `.local/knowledge/`。旧的 `.local/concept-discovery.sqlite` 与 `.local/concept-discovery-self-use/` 也是保留资料，测试和清理不触碰。初始化只创建新的私有根，首次启动会创建库根和关系归档。项目原稿内容在显式同步后进入新实例。

卡片与附件在 `workspace/`，操作备份和回执在 `operations/`，原文、历史提案及事件在 `wiki/`，实例的原稿绑定和未完成批次在 `raw-sync/`。保留原实例及其历史时，将这些目录连同必要配置和凭据整体冷备。

[任务状态](workflow-state.json)只保存当前交接，验证按[风险](rules/testing.md)选择，无固定全量验收要求。
