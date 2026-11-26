# 当前命令

以 package.json 为准，Node 24.7 及以上的 24.x 和锁文件依赖运行轻量检查。HTTPS 认证测试使用 OpenSSL 生成隔离证书，真实内核和浏览器测试另需 Docker/Compose 及 Playwright Chromium。

| 命令 | 用途 |
| --- | --- |
| `npm run doctor` | 检查Node/Git/仓库环境 |
| `npm run validate` | 检查任务入口、引用和现行命令 |
| `npm run check` | 基础文档校验、原稿离线检查与 Node 回归 |
| `npm run build:web` | 构建本地前端资产 |
| `npm run test:integration` | 隔离思源中的原稿写入、公开 API/CLI 读取、写入拒绝、回执恢复及 HTTPS 登录和管理命令撤销 |
| `npm run test:lifecycle` | 使用隔离思源和 Git 远端验证合成卡归档、恢复、并发保护及原生文件清理 |
| `npm run test:database-first` | 使用隔离思源和 Git 远端验证数据库优先写入、四小时批次和待删卡最终清理 |
| `npm run test:lifecycle-proxy` | 用带 `http_auth_request` 的 Nginx 验证旧镜像及待恢复状态下的反代遮断。可用 `CONCEPT_NGINX` 指定二进制 |
| `npm run test:browser` | 桌面浏览器阅读、导航、只读入口与迟到响应回归 |
| `npm run deploy:init` | 初始化新私有目录，拒绝覆盖 |
| `./start-dev.sh` 或 `./start-dev.sh start` | 使用现有私有配置构建并启动应用和内核 |
| `./start-dev.sh stop` | 停止应用和内核，保留知识库数据 |
| `./start-dev.sh restart` | 重新构建应用并重启应用和内核 |

没有强制全量或固定Ego证据协议。验证按[风险](../../rules/testing.md)选择。隔离测试只清理本轮资源，不访问正式知识库。

存储布局、内核或恢复格式改变时，另执行 `node tests/service/wiki-backup-restore.mjs` 冷备恢复检查；普通集成不运行它。失败隔离栈可用 `node tests/service/runtime.mjs cleanup <run-id>` 精确回收。

Docker 不可用时，可为 `npm run test:lifecycle` 显式设置 `CONCEPT_SIYUAN_KERNEL`，指向校验过的 macOS 版思源 3.8.9 内核。此模式使用独立临时用户目录、知识库和回环端口，验证合成卡及恢复业务链路。Compose 挂载与 Linux 进程锁仍用容器模式验收。[思源 3.8.9 官方发布](https://github.com/siyuan-note/siyuan/releases/tag/v3.8.9)

## 本地知识原稿

在仓库根运行下列命令。原稿默认位于 `raw/`，目标实例的私有配置默认位于 `.local/knowledge/`。检查文件只需项目 Node 依赖。查询实例、预览、写入和导出还需要正在运行的目标 Compose 栈，以及访问本机 Docker 的权限。

| 命令 | 用途 |
| --- | --- |
| `npm run raw -- check` | 离线检查 YAML、标识、卡间引用、来源、补充阅读和附件。 |
| `npm run raw -- sync --dry-run` | 列出目标库中待更新的对象、缺失原稿和修订冲突。 |
| `npm run raw -- sync` | 冻结输入，执行变更，读回并保存当前实例的基线。中断后重新执行同一命令，继续已冻结的操作。 |
| `npm run raw -- archive <英文标识>` | 按绑定的文档 ID 和修订号显式软归档。命令返回恢复用的操作 ID。 |
| `npm run raw -- archives` | 核对 Git 原稿、目标实例的归档绑定、回执和写后文档。用 `--git-only` 离线列出原稿已标记的归档卡。 |
| `npm run raw -- status <操作ID>` | 在所选实例核对一份已有回执的状态及可用修订信息。 |
| `npm run raw -- recover <操作ID> --revision <写后修订或哈希>` | 按原回执和完整的 64 位十六进制修订或哈希，受保护地恢复一次有备份的操作。 |
| `npm run raw -- export <新目录>` | 从所选库导出独立副本。目标必须是全新目录。 |

用 `--raw-root <目录>` 选择另一份原稿，用 `--private-root <目录>` 选择另一套私有配置，加 `--json` 取得单行 JSON 输出。写入之前会核实 Compose project、应用和内核的真实挂载与网络。两个从同一冷备恢复的数据库会拥有相同的库标识，使用时需选对私有目录。

正文里写 `[[英文标识|显示文字]]` 或指向另一篇 `article.md` 的相对链接。同时新增的卡可以互相引用。修改原文会创建独立快照，旧出处仍可读。修改附件会按文件内容写入新版本。所选库中的已绑定文档发生独立修改时，同步会报告冲突。

将原附件移动或重命名后，若文件哈希在旧绑定和现有附件中各唯一，且目标库仍有同一份内容，预览会在 `assetMoves` 中列出新旧原稿路径。同步会更新本机绑定，沿用库中的附件地址。

归档前先核对引用该卡的其他原稿。希望保留归档稿时，在 YAML 写入 `status: archived`；从活动目录移除也可以。普通同步只报告缺失项。形成新冷备时一并保存私有根内的 `raw-sync/`，其中包含当前实例的绑定、操作状态和未完成批次。恢复原实例的历史书签与操作回执使用完整冷备。将 Git 原稿同步到全新实例可重建原稿中收录的卡片、原文快照、附件与内部引用。旧实例专有的书签、历史提案、知识事件及回执随冷备恢复。

遇到冲突时，先按报告里的文档 ID 打开当前数据库版本，与原稿比较。若希望保留对方的修改，先合并到原稿。确定下次应采用原稿后，用 `npm run raw -- rebase <英文标识> --revision <actualRevision>` 明确认领刚查过的完整修订号，再预览和同步。补充阅读使用其原稿相对路径。

中断后优先重跑 `sync`。如果此时另一项编辑让原计划无法完成，运行 `npm run raw -- sync --settle`，依据原操作回执核对已开始的写入。已核实的绑定会保留，未开始的项在下一次预览中重新计算。如果报告仍有部分完成项，先用 `npm run raw -- status <操作ID>` 核对原回执，再将报告中的恢复修订用于 `recover`，最后重新运行 `sync --settle`。

恢复单张已归档卡时，使用 `archive` 返回的 `op_id` 和 `revision`。恢复会核对同一目标库和当前修订，并更新已有的本地归档绑定。相同回执和修订可以重跑。如果原稿仍标记为 `status: archived`，需要继续维护时一并调整原稿。

普通整篇保存、旧卡格式转换和整篇恢复在写入时一并记录文档修订和原生块签名。中断后，状态查询和结算用这两项证据确认结果。恢复前还会核对当前文档。即使标题、可见正文和文档修订都相同，子块属性变化也会阻止覆盖。

历史回执若缺少写入时的签名，仅凭修订、正文哈希或事后确认的签名不能自动恢复。这也可能影响实际成功的旧保存。历史完成记录的证据不足或自相矛盾时，查询显示 `unknown` 和 `unproven_document_write`，旧卡转换沿用 `unproven_conversion`。原回执文件保留。未能提供安全恢复版本时，可在独立目录还原冷备，与当前文档及原稿对照，再合并需要的内容。已经完成的旧整篇恢复若保留了完整的原生恢复目标，可在撤销时同时核对原记录的完成修订、块身份、层级及属性。

如果冻结批次里的恢复也发生中断，错误消息会给出这次恢复的操作 ID。用 `status` 核对它，再以**原批次操作 ID 和原写后修订**重跑之前的 `recover` 命令。这样会继续同一份恢复请求。成功后重新结算批次。

初次导出有既有芒格模型映射时，`export` 可一起传 `--ledger <旧账本目录> --models <离线模型目录>`，通过既有文档及快照 ID 确定归属。导出遇到失效的内部引用会报告位置；已核实的单个附件拼写错误可通过 `--asset-corrections <JSON 文件>` 显式提供映射。

## 只读应用 CLI

用 `CONCEPT_DISCOVERY_CONFIG` 指向私有 `client.json`，其中保存应用地址和独立 Agent Token 的配置。`CONCEPT_SERVICE_CONFIG` 是服务端配置，`kernel.json` 供本地维护使用。

```sh
export CONCEPT_DISCOVERY_CONFIG="$PWD/.local/knowledge/client.json"
printf '%s\n' '{"query":"瓶颈","limit":5}' | node bin/concept-discovery.mjs search
```

| 读取内容 | 命令 |
| --- | --- |
| 卡片列表、搜索、结构化字段、整篇正文 | `list`、`search`、`get`、`get-document` |
| 资料和自测问题 | `sources-list`、`source-get`、`wiki-card` |
| 历史整理提案和知识事件 | `wiki-proposals`、`wiki-proposal`、`wiki-events` |

`list` 的 `includeTags: "page"` 为当页条目返回 `items[].tags`。需要当前关键词和日期下的全部可选标签时，使用 `includeTags: true` 并读取顶层 `tags`。指定 `tag` 时先筛选再分页。

网页与日常 CLI 使用相同的只读命令清单，公开 `get-document` 返回 `editable: false`、`deletable: false`。查询从 stdin 接收 JSON，成功时输出 `{ok:true,data}`，失败时向 stderr 输出错误并返回非零状态。旧写入命令会被拒绝。[应用与卡片读取](../../skills/concept-discovery/SKILL.md) · [原文与历史提案读取](../../skills/concept-discovery/references/wiki-workflows.md)

## 应用启动与状态

初始化拒绝已有目录，并分别生成 Agent 与内核凭据。首次启动创建「知识卡」根文档和「关系归档」；需要项目中的内容时，在目标实例显式同步原稿。已有实例继续读取原来的知识库。`GET /api/status` 返回 `{"ok":true,"data":{"readOnly":true}}`，用于健康探针。

### 网页加载耗时

用 `node tests/performance/field-load.mjs --fixture` 跑隔离列表，用 `--fixture --view card` 验证带 HTTPS 站主会话的合成阅读。各组输出五对冷访与正常二访、资源传输字节和内容可读时间。缓存与去敏回归可单独运行 `node --test tests/performance/field-load.test.mjs`。

实站测量以读者实际入口为准。例如 `node tests/performance/field-load.mjs --url https://kb.example.com/cards --view cards --owner-login` 会打开专用浏览器让站主登录；替换为自己的站点。对未登录入口可使用 `--view login`。每对使用新上下文，二访在同一上下文新开页。JSON 写向标准输出，可保存在忽略目录 `.local/performance/`。保留失败样本；零个可读样本时无法计算页面性能。合成测量、公网登录页和已登录阅读页分别报告。

### 升级时保留上一版程序分包

新 HTML 从当前构建清单取带哈希的 JS 和 CSS。为使切换前打开的标签页能继续下载旧分包，在替换运行中的应用容器前，将其 `/app/web/generated/.` 用 `docker cp` 复制到本次发布专用的新目录。只复制这份程序产物，并核对目录根有 `manifest.json`。

将宿主绝对目录设为 `CONCEPT_PREVIOUS_UI_ROOT`，在原 Compose 文件组合后追加 `-f deploy/compose.ui-overlap.yaml` 再启动。该覆盖文件把旧目录只读挂载到 `/ui-previous`。首次部署可直接使用原 Compose 配置。完成切换后，用切换前记录的分包 URL 读回旧文件，再打开新页面确认它引用当前入口；新部署只需保留上一套程序分包。[Compose 覆盖文件](../../deploy/compose.ui-overlap.yaml)

## 开通和恢复站主

新配置带有 `"auth": { "mode": "local" }`，仅允许将 `publicUrl` 设为回环地址，直接进入阅读。旧的纯本机配置若缺少 `auth`，可在原 `service.json` 中加入该字段，沿用已有数据。公网代理接入的实例需设为 `required`，并将 `publicUrl` 与读者的 `client.json.url` 都设成实际 HTTPS 源。配置示例中的字段加到已有 `service.json`，保留原内核和 Agent 配置。

```json
{
  "publicUrl": "https://kb.example.com",
  "auth": { "mode": "required", "databaseFile": "auth.sqlite" }
}
```

在目标主机上执行一次性管理容器。把命令中的私有目录换成目标实例目录。在可信的交互终端填写用户名和密码。开通成功后再启动应用。Ubuntu 等主机上的 HTTPS 代理只转向本机应用端口，保持原 Host 和 Authorization，禁用私有响应的共享缓存。

```sh
docker compose --env-file .local/knowledge/compose.env -f deploy/compose.yaml build app
docker compose --env-file .local/knowledge/compose.env -f deploy/compose.yaml run --rm --no-deps app node bin/auth-admin.mjs init
```

对同一实例使用 `reset-password` 改密，或用 `revoke-all` 撤销所有网页会话。完整冷备包含认证和分享数据库。恢复后保持应用停止，使用同一一次性管理容器分别执行 `revoke-all` 和 `revoke-shares`，清除备份中的会话和分享，再启动应用并开放代理。回退到无登录保护的版本前关闭公网转发。反向代理与应用直连时可配置 `auth.trustedProxyAddress` 为实际代理连接的单一地址，并让代理覆盖 `X-Concept-Client-IP` 为其核实的客户端地址；未配置时按直接连接地址限速。

## 站主卡片维护与冷备门禁

部署前核实托管账本、Git 规则及生产副本的位置。当前实现提供 Git 账本入口。只在实际演练证明账本分支有追加验证、签名校验、写入身份限制及强推和删除限制后启用。原稿服务副本应使用独立 Git 工作目录。维护任务库和账本检查点放在知识库冷备范围之外，运行时分享目录与知识库及工作副本分开。初始化检查点需要独立核实的账本头，不能从旧冷备回填。

GitHub 模式配置 `ledger.githubChecks`，记录仓库、`ledger-candidates/` 下的专用候选前缀、验证应用 ID（`verifier`）和检查名称（`context`）。部署中的独立工作流用验证应用发布同一候选 SHA 的检查。维护服务只接受绑定该应用的成功结果，再按权威父提交做快进发布。用 `scripts/audit-deletion-ledger-rules.mjs` 只读比对正式与演练分支的有效规则及旁路。另实测未授权身份、回退与违规追加均被拒绝。实际 GitHub 应用和候选事件触发仍须在生产验收中核对。

如使用 GitHub Actions 运行独立校验，候选前缀使用 `ledger-candidates/production` 和 `ledger-candidates/drill`。两条账本分别从不同的可信 SSH 签名空根提交开始。工作流先验证已知父提交，确认签名配置和工具可用后才判定候选签名。将[验证工作流](../../.github/workflows/deletion-ledger-verify.yml)发布到默认分支，设置其中引用的变量。验证源码变量须为已审阅的完整提交 SHA。将 `concept-ledger-verifier` 环境限制为仅默认分支部署。验证 App 私钥只写入该环境的 GitHub Secret，安装范围限定本仓库，权限为 Contents 读和 Checks 写。

写入 App 安装范围也限定本仓库，权限为 Contents 写和 Checks 读。其宿主私有配置包含 `appId`、`installationId`、`privateKeyFile` 和 `repository`。为专用 Git 工作副本启用 `credential.useHttpPath=true`，清空继承的 helper，再配置 `scripts/github-app-installation.mjs <私有配置>` 作为 HTTPS 凭据 helper，用绝对 Node 路径启动。将同一写入配置放入 `ledger.githubChecks.writerInstallation`，供宿主发送独立校验事件和读取检查。签署账本提交的 SSH 公钥还须作为 GitHub 签名密钥登记，并核实演练提交在 GitHub 显示为已验证。

```sh
git -C /path/to/dedicated-git-clone config --local credential.useHttpPath true
git -C /path/to/dedicated-git-clone config --local --replace-all credential.helper ''
git -C /path/to/dedicated-git-clone config --local --add credential.helper \
  '!/path/to/node /trusted/release/scripts/github-app-installation.mjs /private/writer-app.json'
```

正式和演练账本的规则分两组。只有写入 App 可绕过限制创建与更新的规则。签名、线性历史、禁止强推、禁止删除和指定验证 App 的必需检查没有旁路。候选引用仅用于传递待核对的提交。验证器核对实际 SHA、可信签名及所属账本上的父提交。启用前读回两个 App 的实际安装权限、验证环境的分支限制及默认分支工作流提交。先在演练分支核对实际快进和拒绝用例，并模拟验证排队或暂时失败，记录代理就绪的持续时间与恢复结果。

在当前部署 Compose 叠加 `deploy/compose.lifecycle.yaml`，设置 `CONCEPT_LIFECYCLE_SOCKET_DIR` 为属主私有的套接字目录，`CONCEPT_SHARE_MATERIALS_DIR` 为实际运行时素材目录。覆盖文件从冷备之外设置维护启用位。应用核对本地 `/api/readiness`，维护进程核对应用实际挂载、内核实例及控制账本。代理在本地 readiness 通过前保持入口关闭。健康探针 `/api/status` 只检测进程，不能用于开放代理或验证恢复。

在 HTTPS `server` 块引入 [Nginx 独立门禁](../../deploy/nginx-lifecycle-gate.conf)，确认现有业务 `location` 继承该检查。应用绑定端口与示例不同时，同步修改门禁探针上游。用 `nginx -t` 验证配置，再逐项核对代理上的旧镜像、维护守护进程离线、冷备仍待清理及正常就绪。授权子请求只发送一次内部 GET，并排除用户 Cookie 和请求体。非 2xx 的就绪状态会关闭业务请求。进程的 loopback `/api/status` 仍用于诊断。

Linux 宿主用 `flock --exclusive --nonblock --no-fork /path/to/controlRoot/host.lock node scripts/start-card-lifecycle.mjs /path/to/private-lifecycle-config.json` 启动服务。私有配置文件设为 0600，记录 `privateRoot`、`controlRoot`、`repository`、`remote`、`materialsRoot`、`socket` 和签名 `ledger` 配置。套接字固定名为 `worker.sock`。宿主与受管内核各自验证所持独占锁，进程退出后由 Linux 释放。进入受管模式前须确认旧直接维护入口已退出，核对遗留的旧式 `operations/write.lock`。受管实例只通过维护服务写入。

站主确认待删后，在受管网站右上角打开「原稿待删」。弹窗按卡列出原稿路径和完整命令。将命令复制到本地项目仓库执行。它按已核实的文件内容与引用范围暂存该卡变更，按需更新导读、原稿绑定、专属分享素材和共享附件引用。检查 `git diff --cached` 后，由站主自行提交并推送到 `main`。目标文件已被独立修改或归属不清时，先核对当前内容再刷新提醒。网站读回主分支后移除对应提醒，线上清理结果在归档页查看。

签入权威删除决定之前，站主可在归档列表预览「撤销待删」并复核密码。原稿尚未由站主移除时，撤销沿原文档 ID 恢复之前的归档状态，旧分享保持失效。站主已手工提交的原稿由站主处理。已签决的线上删除继续按原操作 ID 结算。旧维护版本遗留的待办须先核实其原稿发布及签决状态。

网页确认后将任务写入持久队列。维护线程每 15 秒检查队列，空闲时每 30 秒核实权威账本。代理接入线程独立应答就绪探针，最近一次核实超过 45 秒即关闭门禁。冷启动、冷备回放、处理彻底删除或权威核对失败时保持门禁关闭。

配置 `ledger.githubChecks.writerInstallation` 后，就绪检查和首次初始化用同一安装身份申请限本仓库的 Contents 只读令牌，通过 GitHub 精确引用接口读取账本分支和核验所需的 `main`。令牌在进程中最多复用四分钟，每次核验都重新请求分支头。本地缺少对应提交时，维护进程从指定 Git 远端拉取同一分支，并比对提交 ID。开闸仍须验证账本签名、追加历史、已信任检查点及待办状态。接口失败、两个渠道的提交不一致或主分支历史回退都会阻止开闸。导出、签决、冷备清理及写后读回继续通过 Git 核实。

维护进程在执行需要 Git 读回的操作前，将待复核状态写入冷备之外的控制库。即使队列任务已完成，重启或冷备恢复仍须通过完整 Git 核验才能清除此状态并开闸。

配置 `dataFlow: "database-first"` 的实例先处理知识库写入。原稿导出批次按北京时间 00:00、04:00、08:00、12:00、16:00、20:00 的边界执行。待删卡在确认后隐藏并暂停分享，线上彻底清理仍需等待批次和权威账本读回。启用前须先结算现有 Git 优先任务，启用后不能执行 Git 到数据库的覆盖同步。

批次在创建候选前保存预定文件的字节摘要、文件类型与执行位。已登记的本地 Git 候选引用丢失时，宿主从可信主分支核实原提交及精确父提交。能证明已经发布时恢复原引用并继续读回。无法查证时，批次保留待核对，已发生的权威删除决定仍按原操作处理。

手动验收时，在保有同一宿主锁的维护进程中运行 `scripts/start-card-lifecycle.mjs <私有配置> --run-export-batch <合成卡 rawId>...`。操作前先停常驻维护服务，结束后再启动并核对就绪。此命令与生产定时任务调用同一个批次执行器，只提前认领明确指定、已由数据库创建的合成卡。常规导出仅涉及指定合成卡。待删原稿由站主通过提醒中的命令处理；验收批次须在远端读回后才能结算该卡的线上清理。任一指定卡片仍有未结算操作时返回失败。生产定时边界保持不变。 已在限定批次开始清理的卡遇到中断时，常驻维护会核对同一冻结计划并继续结算。切换或排查时，用实际维护服务身份核对本库私有绑定目录及状态文件的读写权限。

切换数据库优先模式时，先让代理保持关闸，再核对网页应用与维护程序使用同一提交。接收数据库优先写入后，按同一模式恢复应用和维护程序，并保留独立控制库和任务队列。旧版本无法读取数据库优先的任务队列，旧版回退仅可在接受第一笔数据库优先写入前使用。

首次启用时，在同一宿主锁下用 `--initialize-ledger` 初始化检查点，`ledger.initialHead` 取独立核实的账本头。普通更新仍提交到原稿分支。停止维护进程后，可用同一宿主锁和 `--sync-current-main` 将已核对的 `main` 同步到受管实例。命令在同步前后核对删除账本，并拒绝与未完成的维护任务并发。完成后重新启动维护服务并核对就绪状态。

恢复时先关闭代理，在恢复工作区与原控制存储核对后，以同一互斥锁运行启动命令并追加 `--reconcile-recovered`。该入口撤销恢复的旧会话和分享，并按已核实的不可逆决定清理恢复工作区。最后重新核对 `/api/readiness`、删除目标的旧读卡和分享地址，以及保留卡。发现归属不明、副本仍可读或账本版本异常时，保持入口关闭并记录待核对项。生产启用前，在隔离环境运行 `npm run test:lifecycle` 和 `npm run test:lifecycle-proxy` 验证冷备重放与代理门禁。

## 配置微信转发样式

微信公众号需具备网页分享接口权限。在微信公众平台为该公众号配置网站 HTTPS 域名为「JS 接口安全域名」。若要求上传域名校验文件，将平台下发的原文件放在反向代理上的指定路径，并从公网验证其可读取。若公众号启用了接口 IP 白名单，把应用请求微信 API 时使用的公网出口 IP 加入白名单。沿用已有 AppSecret，避免影响公众号的其他集成。 [微信 JS-SDK](https://developers.weixin.qq.com/doc/offiaccount/OA_Web_Apps/JS-SDK.html) · [腾讯云域名配置文档](https://cloud.tencent.com/document/product/1301/100434)

在目标私有目录的 `service.json` 增加以下可选对象，使用真实 AppID。AppSecret 写入同目录的独立文件，权限为 0600，属主为应用容器用户。服务端只从该文件读取 AppSecret。配置后重建或重启应用容器。

```json
{
  "wechatShare": {
    "appId": "wx0123456789abcdef",
    "appSecretFile": "wechat-app-secret"
  }
}
```

在合成知识卡的隔离验收环境校验转发素材后，创建分享链接，并在微信内打开完整地址。用右上角菜单实际转发到好友会话和朋友圈，核对收件人看到的卡片与落地正文。微信朋友圈样式使用标题与封面。公众号配置缺失时仍可使用普通分享及网页预览。更新应用后，旧分享可以启用新版转发预览，再复制新链接。若临时回滚到独立预览上线前的应用，已发新版链接可通过移除 `/share/` 后的预览标识并保留 `#` 后的凭证打开旧版正文。

已生成的素材位于 `server/share-materials/catalog.json` 及同目录的 `covers/`。浏览器不会公开提供整份素材目录。封面文案更新后，在装有 Chromium 的 macOS 上运行 `node scripts/generate-share-covers.mjs` 重新生成 PNG。只创建或启用单张卡的分享时，才公开该卡的标题、摘要和封面。
