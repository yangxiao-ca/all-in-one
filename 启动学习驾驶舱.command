#!/bin/zsh

cd "$(dirname "$0")"

if ! command -v npm >/dev/null 2>&1; then
  osascript -e 'display alert "无法启动学习驾驶舱" message "未找到 Node.js。请先安装 Node.js，然后再试。"'
  exit 1
fi

if curl --silent --fail http://127.0.0.1:47831/api/v1/health >/dev/null 2>&1; then
  open http://127.0.0.1:47831
  exit 0
fi

npm start &
server_pid=$!

cleanup() {
  kill "$server_pid" 2>/dev/null
}
trap cleanup EXIT INT TERM

for attempt in {1..30}; do
  if curl --silent --fail http://127.0.0.1:47831/api/v1/health >/dev/null 2>&1; then
    open http://127.0.0.1:47831
    wait "$server_pid"
    exit $?
  fi
  sleep 1
done

osascript -e 'display alert "无法启动学习驾驶舱" message "本地服务未能在 30 秒内启动。请打开终端检查项目。"'
exit 1
