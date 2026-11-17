# 当前环境入口

使用Node24、Docker Compose和固定思源3.8.9内核。独立应用发布桌面网页，默认回环6806；启动命令见[命令说明](docs/agent-environment/commands.md)。

真实配置和工作区在.local/knowledge。旧.local/concept-discovery.sqlite和.local/concept-discovery-self-use也是保留资料，测试和清理不触碰。初始化拒绝覆盖已有目录。

卡片与附件在workspace，操作备份/回执在operations，原文快照及只读历史提案/事件在wiki。三个目录及必要配置共同备份；历史记录不是缓存。

[任务状态](workflow-state.json)只保存当前交接，验证按[风险](rules/testing.md)选择，无固定全量验收要求。
