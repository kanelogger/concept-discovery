# 单容器内容服务：核准、启动与恢复

本入口将同一版本的 SQLite、附件及转发素材挂载给一个 Node 应用容器。站主配置、内容、认证卷、核准控制目录使用四个并列实体目录。核准控制及其最新检查点摘要由站主独立保管，和认证卷、内容冷备分开。现行思源部署的切换须另有站主窗口。

**所有 Git 操作在站主本机完成。** 本机读取远端原稿和权威删除账本、校验签名、提交和推送。服务器只接收、校验、安装和运行已生成的发布产物。服务器的部署、就绪、重启和回退均禁止使用工作副本、Git 命令、GitHub API 或 GitHub 凭据。首次切流结算旧维护任务后，停用旧 Git 轮询和定时导出。

## 本机准备并核对版本

1. 首次切流，在现行应用停止内容写入后，独立核实正式库身份、已发原文与历史、活动和归档主卡以及未完成批次。在本机获取并验证权威删除账本的最新签名头，单列 `cancelled` 的决定。用同库维护任务的冻结计划、操作 ID 和已核实文档身份，把有效永久决定映射到公开主卡 ID。结算待删与未完成任务，再形成当前核准清单。当前候选的活动列表仅用于比对。
2. 在本机按[离线构建说明](commands.md#离线构建只读内容包)编译一个新的私有版本目录。需要自定义转发素材时在其 `share-materials/` 放置 `catalog.json` 和对应的 `covers/<rawId>.png`。缺少某张卡的素材时使用该卡标题和站点封面。核对完整目录、所有附件和专属封面。发布涉及永久删除时，在开放入口前清理宿主上仍含被删内容的旧版数据库、独占资源和旧工作副本，读回保留卡引用的共用图片。Git 历史与脱离服务宿主的离线冷备按原约定保留。
3. 在本机运行 `npm run content:inspect -- /path/to/release VERIFIED_LIBRARY_ID`，得到内容清单摘要、素材摘要、活动主卡数与程序读取契约。比对独立冻结库存后，由站主生成核准记录。检查输出本身不授予开放权限。

每次发布或回退签准开放前，站主在本机重新获取并验签最新权威删除账本，核对生效决定与 `deletedIds`。在独立核准记录中同时留存账本提交 ID、`deletions.json` 摘要和 `checkpoint.json` 摘要。服务器以这份当前核准的摘要核对磁盘，旧控制文件即使彼此匹配也不能作为开放依据。同版重启继续核对磁盘上的当前记录。隔离验收使用合成权威账本，并对三次读回保存对应关系。

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

在本机核实目标服务器的 Linux 架构，构建并导出程序镜像。将示例中的 `linux/PROD_ARCH` 和 `VERIFIED_VERSION` 替换为核实的平台和本次版本。记录不可变镜像 ID。单独保留上一兼容镜像及其归档，新旧程序都须能核实当前内容格式。

```sh
docker build --platform linux/PROD_ARCH --target content-runtime -f deploy/Dockerfile -t concept-discovery-content:VERIFIED_VERSION .
docker image inspect --format '{{.Id}}' concept-discovery-content:VERIFIED_VERSION
docker image save -o concept-discovery-content-VERIFIED_VERSION.tar concept-discovery-content:VERIFIED_VERSION
```

本机生成发布清单，记录程序镜像 ID、目标平台、内容清单摘要、内容格式和交付文件 SHA-256。经受控通道交付镜像归档、内容包、Compose 文件、本次使用的 Nginx 上游及就绪配置和发布清单。服务器按站主核准的清单摘要验收交付物。核准、删除及检查点文件通过独立控制目录交付。认证卷和密钥单独管理。

服务器从新落盘目录对照站主核准的发布清单校验摘要，导入镜像后核对镜像 ID，再将内容装入新版本目录。启动前确认上一兼容镜像已在宿主可用。

```sh
docker image load -i /path/to/delivery/concept-discovery-content-VERIFIED_VERSION.tar
docker image inspect --format '{{.Id}}' concept-discovery-content:VERIFIED_VERSION
```

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

从回环与真实代理分别验证服务。以规范 Host 获取 `/api/status` 仅表示进程响应，开放依据是 `/api/readiness` 成功以及真实的业务读回。沿用[反代门禁](../../deploy/nginx-lifecycle-gate.conf)，让就绪子请求和业务上游同时指向同一新容器，保留原 Host 和授权头；验证过的入口只绑定宿主回环。控制记录消失、变更或和候选版本不符时，当前进程拒绝继续服务，重新启用需使用新检查点重新启动。Nginx 的原生 auth_request 遇到非预期就绪状态可能对外返回 500，应在宿主关闭窗口单独配置维护响应。

## 回退与生产验收

回退使用服务器已导入的上一**兼容程序镜像**，配当前核准的内容、素材、认证卷与最新控制记录，先闭门，再核对归档 A、已删 B、保留 C、旧分享/封面与 B/C 共用图片。旧内容包、错误卷和已撤销凭证必须被拒。上一个兼容程序不存在时保持关闭并修复当前候选。

### GitHub 不可达时的验收

使用与正式部署同构的隔离宿主。部署目录只准备发布产物及服务数据，不放置项目 Git 工作副本或 GitHub 凭据。阻断宿主和应用容器访问 GitHub，保留入站产物传输和经 Nginx 的 HTTPS 访问。从宿主和容器分别主动验证阻断，为每个探针记录时间和进程来源。三步均在阻断持续期间执行，核对出站记录时可据此辨认探针。

1. **发布。** 上传并校验此前未安装的新镜像与内容包，导入镜像，按闭门核准流程启动并开放。核对运行中的镜像 ID 和内容清单摘要。
2. **重启。** 用同一配置重启应用，确认进程确已重启，镜像和内容版本与重启前一致，就绪恢复，当前认证和分享照常可用。
3. **回退。** 闭门后把程序切回已导入且镜像 ID 不同的上一兼容版本，继续挂载当前核准内容、最新删除记录和当前认证卷。核对镜像已回退、内容仍为当前版本，然后复核开放条件。

每步经代理验证就绪、站主登录、`/cards`、保留卡与共用附件、有效分享，以及归档卡、已删卡和撤销分享的拒绝结果。证据包含导入前后的镜像和内容库存、运行容器的镜像 ID 与启动时间、当前内容和独立检查点摘要、认证卷卷号与世代。保留三步的部署命令和宿主及容器的进程执行记录，以核实部署与服务均未调用 Git。将业务进程与出站记录对应，核实它们没有访问 GitHub。读回只记录测试对象和结果，移除登录及分享凭证。三步全部通过才满足本项切换条件。

实际正式站还需核实旧宿主离线冷备、排空/停写和线上副本物理清理、公网证书、站主登录、微信实机及持续可达性。隔离演练与正式站读回分别记录。
