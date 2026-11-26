# 单容器内容服务：核准、启动与恢复

本入口将同一版本的 SQLite、附件及转发素材挂载给一个 Node 应用容器。站主配置、内容、认证卷、核准控制目录使用四个并列实体目录。核准控制及其最新检查点摘要由站主独立保管，和认证卷、内容冷备分开。现行思源部署的切换须另有站主窗口。

站主在本机准备原稿目录、发布包及累计删除记录。编辑、发布、删卡、重启和备份恢复可以全程离线。服务器接收并校验发布产物与核准文件。首次切流时停用思源的 Git 轮询和定时导出。

## 本机准备并核对版本

1. 首次切流，在现行应用停止内容写入后，独立核实正式库身份、已发原文与历史、活动和归档主卡以及未完成批次。使用切换时已核实的同库累计删除清单，导入站主本机记录。结算待删与未完成任务，再形成当前核准清单。当前候选的活动列表仅用于比对。
2. 在本机按[离线构建说明](commands.md#离线构建只读内容包)编译一个新的私有版本目录。需要自定义转发素材时在其 `share-materials/` 放置 `catalog.json` 和对应的 `covers/<rawId>.png`。缺少某张卡的素材时使用该卡标题和站点封面。核对完整目录、所有附件和专属封面。发布涉及永久删除时，在开放入口前清理宿主上仍含被删内容的旧版数据库、独占资源和旧工作副本，读回保留卡引用的共用图片。Git 历史与脱离服务宿主的离线冷备按原约定保留。
3. 在本机运行 `npm run content:inspect -- /path/to/release VERIFIED_LIBRARY_ID`，得到内容清单摘要、素材摘要、活动主卡数与程序读取契约。比对独立冻结库存后，由站主生成核准记录。检查输出本身不授予开放权限。

每次签准发布或回退前，用站主独立保管的最新清单摘要导出累计删除记录，核对本次检查点中的删除文件摘要。旧内容包、旧认证副本或旧控制文件不能替代最新核准。

核对服务器上已删内容的副本时，一并检查旧内容归档、解包暂存目录及失败安装留下的文件。只含程序的兼容镜像可留作回退。清理后读回保留卡及共享附件。

### 本机累计删除记录

在站主私有的独立目录中保存 SQLite 记录。首次导入使用已经核实的同库累计 `deletions.json`。旧读回收据 `ledger-readback.json` 中的 `deletions` 字段使用紧凑 JSON 编码，字节应匹配已经独立留存的旧 `deletionsSha256`。新库可用同一格式的空清单。以下命令分别保存初始、拟追加和已追加的累计清单。

```sh
npm run --silent content:deletions -- init --database OWNER_DB --library-id LIBRARY_ID \
  --seed EXISTING_DELETIONS --seed-sha256 VERIFIED_SEED_SHA256 > initial-deletions.json
npm run --silent content:deletions -- plan --database OWNER_DB --library-id LIBRARY_ID \
  --current-sha256 CURRENT_DELETIONS_SHA256 --release VERIFIED_RELEASE \
  --manifest-sha256 VERIFIED_MANIFEST_SHA256 PUBLIC_CARD_ID > planned-deletions.json
npm run --silent content:deletions -- add --database OWNER_DB --library-id LIBRARY_ID \
  --current-sha256 CURRENT_DELETIONS_SHA256 --release VERIFIED_RELEASE \
  --manifest-sha256 VERIFIED_MANIFEST_SHA256 PUBLIC_CARD_ID > next-deletions.json
npm run --silent content:deletions -- export --database OWNER_DB --library-id LIBRARY_ID \
  --current-sha256 VERIFIED_NEXT_SHA256 > deletions.json
```

新增前核对目标的主卡 ID、归属和旧链接。命令只接受在已核准发布包中保留身份且不可公开读取的主卡 ID，可以在同一事务登记多张。先独立保存旧清单、待追加清单及各自摘要。提交删除决定前关闭入口并排空请求。追加命令输出应逐字等于待追加清单。若提交中断，用预计的新摘要尝试导出。若新摘要不符而旧摘要仍能导出，可重试该批。读回并独立保管新清单及其摘要，再生成闭门检查点并执行认证和分享清理。删除记录数据库、最新导出及摘要应在站主侧保留独立副本，与站点内容和认证冷备分开。恢复时从当前清单重新生成检查点。

## 控制目录与认证交割

控制目录使用三个 JSON 文件。摘要均为**文件原始字节**的 SHA-256。版本 1 使用下列字段。

| 文件 | 内容 |
| --- | --- |
| `approved.json` | `version`、`libraryId`、正整数 `generation`、`state`（`closed` 或 `open`）、`readerContract`、`manifestSha256`、`materialDigest`、`authIdentity`、完整 `activeIds` 与 `archivedIds`。 |
| `deletions.json` | `version`、同一 `libraryId`、累计生效的稳定主卡 ID 数组 `deletedIds`。依据独立权威决定维护。 |
| `checkpoint.json` | `version`、同一 `libraryId` 和 `generation`、前两份文件的 `approvedSha256` 与 `deletionsSha256`。 |

在**同一实体控制目录内**原子替换文件，先发布关闭状态，逐个读回旧监听器已拒绝业务、排空请求并停止写入。不要替换整个目录：容器的目录绑定可能继续指向旧 inode。服务配置中的 `checkpointSha256` 取可信的当前检查点文件摘要；授权档及启动设置不能一起从旧内容或认证冷备恢复。

首次绑定使用同库停写、已核准来源的认证一致副本，认证文件权限为 0600。闭门核准记录首次 `authIdentity` 可为 null。以下命令在本机仓库执行，处理经授权取得的停写副本。所有交割均显式指定认证文件、库、独立控制目录与核准内容包。

```sh
npm run content:auth -- bind --offline --database /path/auth/auth.sqlite --library-id VERIFIED_ID --release /path/release --manifest-sha256 VERIFIED_MANIFEST --control /path/control --checkpoint-sha256 CLOSED_CHECKPOINT --source-sha256 VERIFIED_AUTH_BACKUP
```

保存读回的卷号和世代 `{volumeId,generation}`。有永久删除决定时，在包含该身份的闭门核准下执行 `reconcile`，参数同上，省略 `--source-sha256`。清理已确认目标的冻结正文、专属封面与 SQLite WAL，并核对保留卡。检查点变化或清理中断时保持关闭，按同一交割记录续跑。恢复同卷旧冷备使用 `restore`，会撤销旧会话及分享、清理已确认永久删除并轮换世代。入口持续关闭，完成核对后将认证卷单独交割至服务器，再签准开放。普通发布继续使用当前认证卷。手工用同世代旧文件覆盖在线卷无法仅凭卷号检出，恢复务必经过闭门流程。

## 构建与启动

站主已确认目标平台为 `linux/amd64`。在本机为目标架构构建程序，再把核准的 SQLite、素材和完整 Nginx/Compose 配置放进新交付目录。下面的版本、库身份与路径需换成本次实际值。Nginx 配置须让业务和就绪子请求使用同一上游。

```sh
docker build --platform linux/amd64 --target content-runtime -f deploy/Dockerfile -t concept-discovery-content:VERSION .
npm run content:package -- --platform linux/amd64 --image concept-discovery-content:VERSION \
  --program-version PROGRAM_REV --input-version RAW_REV --library-id VERIFIED_LIBRARY \
  --release /private/current-content --compose deploy/compose.content.yaml \
  --nginx /private/proxy/nginx.conf --readiness /private/proxy/readiness.conf --output /private/delivery-VERSION
```

在独立核准记录保存命令返回的 `manifestSha256`。交付目录含 `delivery.json`、单平台镜像归档、内容包及三份配置。清单分别记录平台配置摘要、程序及输入版本、SQLite 格式、读取契约和逐文件摘要。认证卷、密钥及核准控制目录单独交割。提前保留并核准上一兼容程序，可仅向服务器导入其程序归档。

服务器预先布置来自可信来源的 [Python 安装器](../../deploy/install-content-delivery.py)，或独立核实脚本摘要。服务器使用 Python 3、支持 STRICT 表的 SQLite 和本机 Docker，无需项目工作副本。将本次交付目录传入后，使用来自独立核准记录的摘要执行安装。

```sh
python3 /opt/site-tools/install-content-delivery.py --delivery /srv/site/uploads/delivery-VERSION \
  --manifest-sha256 VERIFIED_DELIVERY_SHA256 --install-root /srv/site/versions
```

版本库目录须已存在。安装器核对宿主 Docker 平台、交付内容和镜像身份，导入后在新版本目录读回配置、素材及数据库。重复安装复核原目录。将返回的 `contentDirectory` 和 `imageRef` 配入 Compose；用返回的 `imageId` 核对活动容器的实际程序。两个引擎可能分别用平台 manifest 或 config 标识同一程序，交付清单保存可对照的不可变摘要。

在独立只读设置目录放入站主配置的令牌文件及 `service.json`。示例中的值需替换为实际核对结果：

```json
{
  "backend":"content", "host":"0.0.0.0", "port":3000,
  "publicUrl":"https://kb.example.com", "libraryId":"VERIFIED_ID",
  "contentRelease":"/content", "authDirectory":"/auth", "controlDirectory":"/control",
  "agentTokenFile":"agent-token", "auth":{"mode":"required","databaseFile":"auth.sqlite"},
  "manifestSha256":"VERIFIED_MANIFEST", "checkpointSha256":"OPEN_CHECKPOINT"
}
```

`CONCEPT_CONTENT_IMAGE` 选择已构建并核实的程序，`CONCEPT_CONTENT_RELEASE`、`CONCEPT_CONTENT_SETTINGS`、`CONCEPT_CONTENT_CONTROL`、`CONCEPT_CONTENT_AUTH` 指向四个宿主目录。`CONCEPT_PORT` 只发布在宿主回环；选择当前系统用户能写入专属认证卷的 UID/GID。只读内容目录和镜像内都不存放站主密钥。

```sh
docker compose --project-name SITE_PROJECT --env-file /path/to/content.env -f /path/to/delivery/compose.content.yaml up --no-build --pull never -d
```

同一站点部署时使用固定的 Compose 项目名。Compose 文件从交付目录读取，服务器无需源码、构建步骤或镜像拉取。

正式站的常驻容器使用固定项目名 `concept-discovery-content`，回环端口为 `16806`。正式部署配置保存在宿主 `/etc/concept-discovery-content/compose.yaml` 与同目录的 `compose.env`。从这两份文件操作现有服务。内容包更新时重新核对配置中的镜像及内容目录。


从回环与真实代理分别验证服务。以规范 Host 获取 `/api/status` 仅表示进程响应，开放依据是 `/api/readiness` 成功以及真实的业务读回。沿用[反代门禁](../../deploy/nginx-lifecycle-gate.conf)，让就绪子请求和业务上游同时指向同一新容器，保留原 Host 和授权头；验证过的入口只绑定宿主回环。控制记录消失、变更或和候选版本不符时，当前进程拒绝继续服务，重新启用需使用新检查点重新启动。Nginx 的原生 auth_request 遇到非预期就绪状态可能对外返回 500，应在宿主关闭窗口单独配置维护响应。

## 回退与生产验收

回退使用服务器已导入的上一**兼容程序镜像**，配当前核准的内容、素材、认证卷与最新控制记录，先闭门，再核对归档 A、已删 B、保留 C、旧分享/封面与 B/C 共用图片。旧内容包、错误卷和已撤销凭证必须被拒。上一个兼容程序不存在时保持关闭并修复当前候选。

### GitHub 不可达时的验收

使用与正式部署同构的隔离宿主。准备独立的 Docker daemon、宿主 Nginx 和只属于本轮的观测组件。[隔离宿主准备与观察器](offline-drill-host.md)

部署目录只准备发布产物及服务数据，不放置项目 Git 工作副本或 GitHub 凭据。阻断宿主和应用容器访问 GitHub，保留入站产物传输和经 Nginx 的 HTTPS 访问。从宿主和容器分别主动验证阻断，为每个探针记录时间和进程来源。三步均在阻断持续期间执行，核对出站记录时可据此辨认探针。

1. **发布。** 上传并校验此前未安装的新镜像与内容包，导入镜像，按闭门核准流程启动并开放。核对运行中的镜像 ID 和内容清单摘要。
2. **重启。** 用同一配置重启应用，确认进程确已重启，镜像和内容版本与重启前一致，就绪恢复，当前认证和分享照常可用。
3. **回退。** 闭门后把程序切回已导入且镜像 ID 不同的上一兼容版本，继续挂载当前核准内容、最新删除记录和当前认证卷。核对镜像已回退、内容仍为当前版本，然后复核开放条件。

每步经代理验证就绪、站主登录、`/cards`、保留卡与共用附件。三步沿用同一条预先签发的有效分享，用保留卡先前已撤销的另一条旧链接核对拒绝结果，同时核对归档卡、永久删除卡的旧分享及封面。证据包含导入前后的镜像和内容库存、运行容器的镜像 ID 与启动时间、当前内容和独立检查点摘要、认证卷卷号与世代。保留三步的部署命令和宿主及容器的进程执行记录，以核实部署与服务均未调用 Git。将业务进程与出站记录对应，核实它们没有访问 GitHub。读回只记录测试对象和结果，移除登录及分享凭证。三步全部通过才满足本项切换条件。

实际正式站还需核实旧宿主离线冷备、排空/停写和线上副本物理清理、公网证书、站主登录、微信实机及持续可达性。隔离演练与正式站读回分别记录。
