# 本地验证入口

当前未配置远端CI。按[验证规则](../../rules/testing.md)选择检查；完整交付入口为 `npm run check:full -- --ego-run <id>`，由全部自动化和与当前输入匹配的ego-lite真实用户证据共同构成。不能将本地结果描述为远端CI通过。

需要Node24、锁文件依赖、Docker/Compose、Playwright Chromium及ego-lite。真实验收使用独立工作区并精确清理；证据先由独立Agent核对数据再审代码。历史记录不自动成为本轮通过证据。
