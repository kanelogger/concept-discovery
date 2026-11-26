# 离线发布演练的专用宿主

本站由站主确认的程序平台为 `linux/amd64`。隔离宿主使用 Ubuntu 24.04、独立 Docker Engine 29 和 Compose 插件，Nginx 运行在宿主。站主机持有项目工作副本、Git 凭据、账本及签名材料。演练端接收发布件、测试夹具与观测工具。先准备测试机和工具，再封锁出站并导入发布件。[发布与业务验收](content-release.md)

## 创建与核实宿主

新机名称采用 `cd-routea-` 加小写字母或数字。全系统虚拟机可使用独立 amd64 Linux 内核。本次 Apple Silicon 上使用 OrbStack 2.2.5，以如下命令建立隔离机器。每次新镜像首次导入验收使用空的 Docker 库和部署目录。

```sh
orbctl create --isolated --isolate-network --arch amd64 --memory 4G --cpus 2 --disk 20G --user drill ubuntu:24.04 cd-routea-EXAMPLE
orbctl info cd-routea-EXAMPLE --format json
```

将示例名称替换为本轮实际名称。留存 `record.image` 和 `record.config` 中的平台、限额、`isolated`、`isolate_network`、`forward_ssh_agent` 和自定义挂载。共享目录和 SSH agent 转发均关闭。通过 `orbctl run -m MACHINE -u root -w / …` 操作该机。`orbctl push -m MACHINE` 只复制点名的工具。OrbStack 的隔离机器共用其 Linux 内核；其网络隔离开关仍允许访问互联网。正式演练用 guest 自有 nft 规则封锁出站。[OrbStack 隔离说明](https://docs.orbstack.dev/machines/isolated)

首次进入 guest 时留存 `uname -smr`、`dpkg --print-architecture`、`/etc/os-release`、`systemd-detect-virt`、`findmnt -rn -o TARGET,FSTYPE,SOURCE`。检查没有 Mac 共享、项目工作副本、SSH agent、GitHub 凭据或已有的 `/run/docker.sock`。本次核实的 `/opt/orbstack-guest` 是 OrbStack 适配层的 overlay。收到任何来源不明的共享挂载时先核实来源。

在 guest 的根终端执行以下准备。临时 mask 避免包安装时自动打开系统默认站点。

```sh
install -d -m 700 /var/lib/concept-offline-drill /usr/local/lib/cd-routea-observe
hostname > /var/lib/concept-offline-drill/.dedicated-host
systemctl mask docker.service docker.socket containerd.service nginx.service nftables.service
apt-get update
apt-get install --no-install-recommends docker.io docker-compose-v2 nginx nftables tcpdump strace python3 curl
mv /etc/nginx/sites-enabled/default /etc/nginx/default-packaged-site.link
printf '%s\n' 'server { listen 127.0.0.1:8080; server_name localhost; access_log off; return 204; }' > /etc/nginx/conf.d/drill-bootstrap.conf
nginx -t
systemctl unmask docker.service docker.socket containerd.service nginx.service
systemctl start nginx.service docker.service
systemctl is-active docker.service containerd.service nginx.service
docker --host unix:///run/docker.sock info --format '{{.Name}} {{.ServerVersion}} {{.OSType}}/{{.Architecture}} {{.DockerRootDir}}'
docker --host unix:///run/docker.sock compose version
docker --host unix:///run/docker.sock ps -aq
docker --host unix:///run/docker.sock image ls -aq
curl -so /dev/null -w '%{http_code}\n' http://127.0.0.1:8080/
```

核对三项服务均为 `active`，Docker 返回本轮专用主机名、目标架构和 guest 数据目录，容器与镜像清单为空，Nginx 返回 `204`。Docker CLI 显式访问该 guest 启动的 Unix socket。执行身份和软件包摘要记录在本次私有收据中。

## 安装只观察本轮进程的工具

站主先核对[观测脚本](../../tests/service/content-offline-observe.sh)与[文件描述符执行核对组件](../../tests/service/content-offline-execfd.c)的 SHA-256。组件在 strace 的 ptrace 停点打开 tracee 的实际执行对象并计算 SHA-256。它与 strace 必须使用实际 Linux 内核的系统调用 ABI。使用 `readelf -h` 分别检查 strace、动态加载器和 `.so` 的 Machine 字段，再执行正负对照。

在同架构 Linux 准备机，可用 `cc`、`libc6-dev` 和对应的 Linux UAPI 头文件编译组件。

```sh
cc -fPIC -shared -O2 -Wall -Wextra -Werror content-offline-execfd.c -ldl -o trace-execfd.so
sha256sum content-offline-execfd.c content-offline-observe.sh trace-execfd.so
readelf -h trace-execfd.so
```

用发行版签名包提供 strace、对应动态加载器和 libc。对于本次 OrbStack 的 amd64 guest，站主机 OrbStack 的 Linux 内核为 arm64，guest `uname -m` 为 `x86_64`，`systemd-detect-virt` 为 `lxc`。安装 amd64 Ubuntu 提供的 `gcc-aarch64-linux-gnu libc6-dev-arm64-cross`，以 `aarch64-linux-gnu-gcc` 替换上例的 `cc`。使用单独的 APT 列表，从 `https://ports.ubuntu.com/ubuntu-ports` 的 `noble main` 配合 Ubuntu archive keyring 下载 `strace:arm64`、`libc6:arm64`，以 `dpkg-deb -x` 展开。独立 apt 列表使用 `APT::Architecture=arm64`、专用 `Dir::State::lists` 及 `Dir::Etc::sourcelist`。只将 `strace`、`ld-linux-aarch64.so.1`、`libc.so.6`、编译后的 `trace-execfd.so` 放入新 guest 的 `/usr/local/lib/cd-routea-observe/`。保存准备机的源码、包版本、已校验 APT 包摘要和编译产物摘要，在接收端逐项比对。正式 VPS 的底层 runc 版本仍需单独核实。

安装下列包装器到 `/usr/local/bin/cd-routea-kernel-strace`，权限设为 `0755`。原生 amd64 全系统虚机选用自身的 `ld-linux-x86-64.so.2` 及同架构工具。`--preload` 仅作用于这一次 strace 进程。新 guest 上安装观测脚本到 `/var/lib/concept-offline-drill/observe.sh`，设为 `root:root`、`0700`。

```sh
#!/bin/sh
set -eu
dir=/usr/local/lib/cd-routea-observe
exec "$dir/ld-linux-aarch64.so.1" --library-path "$dir" --preload "$dir/trace-execfd.so" "$dir/strace" "$@"
```

`start` 自动运行已安装且通过包校验的 `runc --version`，为实际执行的文件建立独立摘要。还以相同的伪装 argv 分别运行系统 `true` 和 `false`，要求采到两个不同且正确的文件摘要。此次 OrbStack 的包信息为 runc 1.3.4，运行时为 1.2.2。实际 runc 受封内存副本与包内文件分别记录摘要。本机 `.local/content-acceptance/host-cd-routea-b843/` 下，`provision.json` 记录专属宿主和首装产物，`toolchain.json` 记录实际编译的 C 源码、签名包、原生运行库和 ELF 机器码字段及 SHA-256，`recovery.json` 列出最终观测脚本摘要和故障回收读回。

## 运行、回收与证据

站主机的[编排器](../../tests/service/content-offline-integration.mjs)维护 `run-` 加 12 位小写十六进制的唯一 ID。`start <GitHub 公网 IPv4> <run-id>` 先登记独占归属，再启动只跟踪 guest 的 Docker、containerd 与 Nginx 进程树的临时 systemd units，以及 guest 网络命名空间内的包头记录。使用站主核实的 `github.com` 公网 A 记录。`run` 包住部署命令，`host-probe` 和 `container-probe` 从宿主和容器触发可辨认的阻断事件，`snapshot` 记录规则、计数和容器，`finish <run-id>` 核对归属并收束记录。三步均在出站封锁生效的窗口中执行。

无论是否完成 `start` 或 `finish`，编排器在 `finally` 中执行 `abort <run-id>`。它只停止对应 run 的 units，校验 nft 表的所有权并移除对应规则，重新读回现场，将结果写入该 run 的 `cleanup.json`。`status <run-id>` 再次读取实时状态。返回 `cleaned: true` 且 units 为空、`firewallOwner: absent` 表示回收已完成。其他 run 已占用或现场有无主资源时，保留现场并报告冲突。已使用的 run 目录保持独立，再次演练使用新 ID。

将普通的脱敏 trace 文件导回站主机；保留可信的同轮 `run.json` 与所有权、镜像和目录摘要。执行 `python3 tests/service/content-offline-review.py TRACE_DIR` 进行离线核对，也可用 `--run TRUSTED_RUN_JSON` 指定对应记录。核对器比较三步容器 ID 和程序身份、五次应用 entrypoint 与 Node 的同 PID 启动、独立探针和进程/网络证据。正式生产切换另行验收。[离线证据核对程序](../../tests/service/content-offline-review.py)
