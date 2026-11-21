#!/bin/sh
set -eu

usage='用法：./start-dev.sh [start|stop|restart]'
if [ "$#" -gt 1 ]; then
  printf '%s\n' "$usage" >&2
  exit 2
fi

case "${1-start}" in
  start) set -- start ;;
  stop) set -- stop ;;
  restart) set -- start -- --force-recreate ;;
  -h|--help) printf '%s\n' "$usage"; exit 0 ;;
  *) printf '%s\n' "$usage" >&2; exit 2 ;;
esac

CDPATH='' cd -- "$(dirname -- "$0")"

if [ ! -r .local/knowledge/compose.env ]; then
  printf '%s\n' '无法读取 .local/knowledge/compose.env。首次使用请运行 npm run deploy:init；已有知识库请检查配置和权限。' >&2
  exit 1
fi

if [ "$1" = start ] && [ -z "${DOCKER_HOST:-}" ] && command -v orbctl >/dev/null 2>&1 &&
  [ "$(docker context show)" = orbstack ] && ! docker info >/dev/null 2>&1; then
  orbctl start
fi

exec npm "$@"
