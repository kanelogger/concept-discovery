#!/usr/bin/env bash
# Run as root in the dedicated Ubuntu drill guest. The owner supplies a freshly
# resolved GitHub IPv4. Evidence contains program names and flow metadata only.
set -Eeuo pipefail
umask 077
root=/var/lib/concept-offline-drill
self="$root/observe.sh"
owner_link="$root/trace/active"
trace=
table=cd_routea_offline
engine=(docker --host unix:///run/docker.sock)
die() { echo "$*" >&2; exit 1; }
[[ $(id -u) == 0 && $(hostname) == cd-routea-* && -f "$root/.dedicated-host" ]] || die 'Dedicated guest required'
[[ $(cat "$root/.dedicated-host") == "$(hostname)" && $(readlink -f "$0") == "$self" ]] || die 'Guest identity or observer path mismatch'
[[ $(stat -c '%u:%a' "$root") == 0:700 ]] || die 'Drill root must be owned by root, mode 0700'
tracer=$(command -v cd-routea-kernel-strace || command -v strace)
phase() { [[ $1 =~ ^[a-z][a-z0-9-]{0,50}$ ]] || die 'Invalid evidence label'; }
now() { date -u +%FT%T.%NZ; }
run_id() { [[ $1 =~ ^run-[a-f0-9]{12}$ ]] || die 'Invalid run ID'; }
select_run() {
  run_id "$1"; run=$1; trace="$root/trace/$run"
  flow_unit="cd-routea-drill-$run-flow.service"; exec_unit="cd-routea-drill-$run-exec.service"
}
units() { systemctl list-units --all --plain --no-legend 'cd-routea-drill-*.service' | awk '{print $1}'; }
firewall_owner() {
  # A netlink read error cannot be interpreted as an absent table.
  nft -j list ruleset | python3 -c '
import json,sys
items=[i["table"] for i in json.load(sys.stdin)["nftables"] if "table" in i]
print(next((t.get("comment","unowned") for t in items if t["family"]=="inet" and t["name"]==sys.argv[1]),"absent"))' "$table"
}
active_owner() {
  if [[ -L $owner_link ]]; then readlink "$owner_link"; elif [[ -e $owner_link ]]; then die 'Invalid owner record'; fi
}
report_state() {
  local reason=$1 active present firewall
  active=$(active_owner); present=$(units); firewall=$(firewall_owner)
  python3 -c '
import json,sys
run,owner,units,firewall,reason=sys.argv[1:]
print(json.dumps(dict(run=run, owner=owner or None, units=units.split(), firewallOwner=firewall,
                     cleaned=not owner and not units and firewall=="absent", reason=reason)))' \
    "$run" "$active" "$present" "$firewall" "$reason"
}
abort_run() {
  local active present firewall unit state
  active=$(active_owner); present=$(units); firewall=$(firewall_owner)
  if [[ -z $active ]]; then
    if [[ -n $present || $firewall != absent ]]; then report_state unowned-resources; return 1; fi
    report_state already-clear; return 0
  fi
  if [[ $active != "$run" ]]; then report_state different-run-active; return 1; fi
  if [[ $firewall != absent && $firewall != "$run" ]]; then report_state foreign-table; return 1; fi
  for unit in $present; do
    if [[ $unit != "$exec_unit" && $unit != "$flow_unit" ]]; then report_state foreign-unit; return 1; fi
  done
  for unit in $present; do systemctl stop "$unit" >&2 || :; done
  present=$(units); if [[ -n $present ]]; then report_state units-remain; return 1; fi
  if [[ $firewall == "$run" ]]; then nft delete table inet "$table"; fi
  firewall=$(firewall_owner); [[ $firewall == absent ]] || { report_state table-remains; return 1; }
  unlink "$owner_link"
  state=$(report_state released)
  printf '%s\n' "$state" > "$trace/cleanup.json"; printf '%s\n' "$state"
}

filter() {
  # strace may print secrets in argv. Pass its output only through this pipe,
  # never through the journal or a regular file. Collect attempts, including failures.
  python3 -u -c '
import json, os, re, sys
for line in sys.stdin:
    event = re.match(r"(?:\[pid\s+)?(\d+)\]?\s+(\d+\.\d+)\s+(execveat|execve|connect)\(", line)
    if not event: continue
    pid, stamp, op = event.groups()
    out = dict(pid=int(pid), time=stamp, syscall=op)
    text = line[event.end():]
    if op.startswith("execve"):
        path = re.search(r"\"((?:[^\"\\]|\\.)*)\"", text)
        out["program"] = os.path.basename(path.group(1)) if path else None
    else:
        family = re.search(r"sa_family=(AF_[A-Z0-9_]+)", text)
        out["family"] = family.group(1) if family else None
        if out["family"] in ("AF_INET", "AF_INET6"):
            addr = re.search(r"(?:inet_addr\(|inet_pton\(AF_INET6, )\"([a-fA-F0-9:.]+)\"", text)
            port = re.search(r"sin6?_port=htons\((\d+)\)", text)
            out.update(address=addr.group(1) if addr else None, port=int(port.group(1)) if port else None)
    print(json.dumps(out), flush=True)
' >> "$trace/$1.exec.jsonl"
}
watch_services() {
  local targets=() pid
  for service in dockerd containerd nginx; do
    local found
    found=$(pidof "$service") || die "Missing guest service $service"
    for pid in $found; do targets+=(-p "$pid"); done
  done
  export CD_ROUTEA_EXECFD_LOG="$trace/services.fd.jsonl"
  exec "$tracer" -f -qq -ttt -s 256 -e trace=execve,execveat,connect -o "|/bin/bash $self _filter services" "${targets[@]}"
}
watch_net() {
  # Read only this network namespace's dedicated NFLOG group. Text headers only.
  exec tcpdump -l -nn -tt -q -i nflog:1068 > "$trace/rejected-flows.txt" 2> "$trace/capture.status"
}
require_observers() {
  systemctl is-active --quiet "$flow_unit" || die 'Flow observer inactive'
  systemctl is-active --quiet "$exec_unit" || die 'Execution observer inactive'
  for service in dockerd containerd nginx; do
    local pid
    for pid in $(pidof "$service"); do
      awk '$1=="TracerPid:"{found=$2!=0} END{exit !found}' "/proc/$pid/status" || die "Guest $service PID is untraced"
    done
  done
}
traced() {
  local label=$1; shift; phase "$label"
  local base="$trace/$label" rc=0
  [[ ! -e "$base.start" && $# -gt 0 ]] || die 'Provide command and a fresh stage label'
  now > "$base.start"
  # The command keeps its stdout/stderr and exit status. Only strace feeds the filter.
  CD_ROUTEA_EXECFD_LOG="$base.fd.jsonl" "$tracer" -f -qq -ttt -s 256 -e trace=execve,execveat,connect -o "|/bin/bash $self _filter $label" -- "$@" || rc=$?
  printf '%s %s\n' "$(now)" "$rc" > "$base.end"
  [[ -s "$base.exec.jsonl" ]] || die "No execution events recorded for $label"
  return "$rc"
}
counter() { nft -j list counter inet "$table" "$1" | python3 -c 'import json,sys; print(next(i["counter"]["packets"] for i in json.load(sys.stdin)["nftables"] if "counter" in i))'; }
snapshot() {
  phase "$1"; require_observers
  local p="$trace/$1"; [[ ! -e "$p.nft.json" ]] || die 'Use a fresh snapshot label'
  now > "$p.time"; nft -j list table inet "$table" > "$p.nft.json"
  "${engine[@]}" ps --no-trunc --format '{{.ID}} {{.Image}} {{.Names}}' > "$p.containers"
}
start() {
  [[ ! -e /mnt/mac && ! -e /mnt/host && ! -e /Users && ! -e /Volumes ]] || die 'Host share is present'
  findmnt -rn -o TARGET,FSTYPE,SOURCE | awk '
    $2 ~ /^(9p|virtiofs|vboxsf|fuse\.sshfs|nfs4?|cifs)$/ || $3 ~ /\/(mnt\/mac|Users|Volumes)(\/|]|$)/ { shared=1 }
    END { exit shared ? 1 : 0 }' || die 'Shared filesystem mount is present'
  [[ -z ${DOCKER_HOST:-} && $("${engine[@]}" info --format '{{.Name}}') == "$(hostname)" ]] || die 'Incorrect Docker endpoint'
  [[ -S /run/docker.sock && -n $(pidof dockerd) && -z $("${engine[@]}" ps -q) ]] || die 'Start with an idle guest-owned Docker daemon'
  ip4=$(python3 -c 'import ipaddress,sys; a=ipaddress.IPv4Address(sys.argv[1]); assert a.is_global; print(a)' "$1")
  local active present firewall
  active=$(active_owner); present=$(units); firewall=$(firewall_owner)
  [[ -z $active && -z $present && $firewall == absent ]] || die 'Previous observer resources or ownership record still present'
  mkdir -p "$root/trace"; mkdir "$trace" || die 'Use a fresh run ID'
  # Atomic exclusive reservation precedes both transient units and the nft batch.
  ln -s "$run" "$owner_link"; ln -sfn "$trace" "$root/trace/current"
  printf '%s\n' "$ip4" > "$trace/github-ipv4"; now > "$trace/start.time"
  printf '%s\n' "$(hostname)" "$(uname -smr)" "$(systemd-detect-virt || true)" > "$trace/platform"
  "${engine[@]}" info --format '{{.Name}} {{.ServerVersion}} {{.OSType}}/{{.Architecture}} {{.DockerRootDir}}' > "$trace/engine"
  # Only loopback, Docker's guest bridge(s) and replies to incoming connections
  # are allowed. The final rule also blocks new, previously unknown uplinks.
  {
    echo "add table inet $table { comment \"$run\"; }"
    for name in host_probe container_probe host_other container_other; do echo "add counter inet $table $name"; done
    for chain in output forward; do
      local side=host port=46401; if [[ $chain == forward ]]; then side=container; port=46402; fi
      echo "add chain inet $table $chain { type filter hook $chain priority -20; policy accept; }"
      echo "add rule inet $table $chain oifname { \"lo\", \"docker0\" } return"
      echo "add rule inet $table $chain oifname \"br-*\" return"
      echo "add rule inet $table $chain ct direction reply ct state established,related return"
      echo "add rule inet $table $chain ip daddr $ip4 tcp sport $port tcp dport 443 counter name ${side}_probe log group 1068 snaplen 96 reject"
      echo "add rule inet $table $chain counter name ${side}_other log group 1068 snaplen 96 reject"
    done
  } > "$trace/egress.nft"
  systemd-run --quiet --collect --unit="$flow_unit" /bin/bash "$self" _flow
  systemd-run --quiet --collect --unit="$exec_unit" /bin/bash "$self" _exec
  local ready=0
  for _ in {1..40}; do
    if (require_observers) 2>/dev/null && grep -q 'listening on nflog:1068' "$trace/capture.status"; then ready=1; break; fi
    sleep .25
  done
  [[ $ready == 1 ]] || die 'Guest observers failed startup checks'
  traced exec-control /usr/bin/true
  grep -q '"program": "true"' "$trace/exec-control.exec.jsonl" || die 'Failed execve positive control'
  local runtime; runtime=$(command -v runc)
  local owner; owner=$(dpkg-query -S "$runtime" | cut -d: -f1)
  [[ -z $(dpkg --verify "$owner") ]] || die 'Installed guest runtime package differs'
  printf '%s\n' "$owner" > "$trace/runc.package"
  sha256sum /usr/bin/true /usr/bin/false "$runtime" > "$trace/control-binaries.sha256"
  traced runc-control "$runtime" --version > "$trace/runc.version"
  local object
  for object in true false; do
    traced "fd-control-$object" /usr/bin/python3 -c '
import os, sys
name=sys.argv[1]
pid=os.fork()
if not pid:
    fd=os.open("/usr/bin/"+name, os.O_RDONLY); os.set_inheritable(fd,True)
    os.execve("/proc/self/fd/"+str(fd),["same-decoy-argv"],{})
status=os.waitpid(pid,0)[1]
assert os.WIFEXITED(status) and os.WEXITSTATUS(status)==int(name=="false")' "$object"
    local expected; expected=$(sha256sum "/usr/bin/$object" | cut -d' ' -f1)
    grep -q "$expected" "$trace/fd-control-$object.fd.jsonl" || die 'Descriptor byte identity control failed'
  done
  nft -f "$trace/egress.nft"; snapshot baseline
  printf '%s\n' "$trace"
}
probe() {
  local kind=$1 ip4 before after; shift
  ip4=$(cat "$trace/github-ipv4"); before=$(counter "${kind}_probe")
  case $kind in
    host) python3 - "$ip4" <<'PY'
import socket,sys
with socket.socket(socket.AF_INET,socket.SOCK_STREAM) as sock:
    sock.settimeout(4); sock.bind(("",46401))
    try: sock.connect((sys.argv[1],443))
    except (TimeoutError,OSError): pass
    else: raise SystemExit("Unexpected guest egress")
PY
    ;;
    container) "${engine[@]}" exec "$1" node -e '
const s=require("node:net").connect({host:process.argv[1],port:443,localPort:46402});
s.setTimeout(4000,()=>s.destroy()); s.on("error",()=>{}); s.on("connect",()=>{process.exitCode=1; s.destroy();});' "$ip4" ;;
  esac
  after=$(counter "${kind}_probe"); (( after > before )) || die "$kind probe did not reach its assigned firewall rule"
  printf '%s %s %s %s\n' "$(now)" "$kind" "$before" "$after" >> "$trace/probes.txt"
}
finish() {
  if [[ -s $trace/finish.time ]]; then printf '%s\n' "$trace"; return; fi
  [[ -s "$trace/services.exec.jsonl" && -s "$trace/rejected-flows.txt" && -s "$trace/probes.txt" ]] || die 'Execution or flow evidence is incomplete'
  if [[ ! -f $trace/finished.nft.json ]]; then snapshot finished; fi
  systemctl stop "$exec_unit" "$flow_unit"
  now > "$trace/finish.time"; readlink -f "$trace"
}
case ${1:-} in
  start|abort|finish) exec 9>>"$root/observer.lock"; flock -x 9 ;;
  run|host-probe|container-probe|snapshot|status) exec 9>>"$root/observer.lock"; flock -s 9 ;;
esac
case ${1:-} in
  start) [[ $# == 3 ]] || die 'start <resolved-github-ipv4> <run-id>'; select_run "$3"; start "$2"; exit ;;
  finish) [[ $# == 2 ]] || die 'finish <run-id>'; select_run "$2"
    [[ $(active_owner) == "$run" ]] || die 'Finish requested by a different run'; finish; exit ;;
  abort|status) [[ $# == 2 ]] || die 'Provide run ID'; select_run "$2"
    if [[ $1 == abort ]]; then abort_run; else report_state observed; fi; exit ;;
esac
select_run "$(active_owner)"
case ${1:-} in
  _filter) phase "$2"; filter "$2" ;;
  _exec) watch_services ;;
  _flow) watch_net ;;
  run) [[ $# -ge 3 ]] || die 'run <stage> <program> [args]'; require_observers; shift; traced "$@" ;;
  host-probe) require_observers; probe host ;;
  container-probe) [[ $# == 2 ]] || die 'container-probe <container>'; require_observers; probe container "$2" ;;
  snapshot) snapshot "$2" ;;
  *) die 'Use start, run, host-probe, container-probe, snapshot, finish, abort or status' ;;
esac
