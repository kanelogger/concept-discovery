# 当前环境入口

本项目使用Node24、Docker Compose及内部思源3.8.9内核，独立应用发布桌面网页。启动与完整回归见[命令说明](docs/agent-environment/commands.md)，脚本以package.json为准。

新的私有配置位于.local/knowledge，初始化拒绝覆盖现存目录；旧.local/concept-discovery.sqlite和.local/concept-discovery-self-use是保留的真实资料，不属于测试垃圾。正式库在本机 6806 运行。

[任务状态](workflow-state.json)记录当前交接。
