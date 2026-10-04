# 本地与 CI

配置事实源：[GitHub Actions](../../.github/workflows/check.yml)。最近核实：2026-10-05；维护者为环境变更执行者。工作流、运行时或权限变化时重验。

| 环境 | 运行条件 | 验证与限制 |
| --- | --- | --- |
| 本地 | 本次 macOS；Node 24，npm，Git | `npm run check` 包含 Node/API 与 Playwright 浏览器测试；浏览器需先安装 |
| CI | GitHub 托管 Ubuntu，Node 24；只读仓库权限 | 安装 Playwright Chromium/Firefox/WebKit 与系统依赖，再执行 doctor、check；配置落盘不等于远端已运行 |
| 发布 | 尚无发布环境、凭据或配置 | 不适用；未来按实际部署方案补充 |

CI 在 push / pull request / 手动触发时运行相同检查，不自动修复、提交、推送或发布。当前任务不触发远端操作；远端结果需在首次推送后读取实际日志确认。

本地和 CI 的 Node 补丁、npm 版本及操作系统可以不同，当前工具只依赖 Node 内置 API。工具测试使用临时目录及跨平台路径 API；本次 Linux 执行结果仍由远端 CI 或独立 Linux 运行提供。不要将未运行的平台标为验证通过。

新增产品测试、依赖或服务时同步扩展本地命令和 CI，必要时增加操作系统矩阵；有真实差异再记录，不预建发布凭据或基础设施。Playwright WebKit 和 Pixel 7 模拟覆盖不等价于物理 iOS Safari/Android Chrome；该机器没有实际移动设备连接，最终设备验收单独记录。
