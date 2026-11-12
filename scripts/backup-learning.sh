#!/bin/zsh
set -euo pipefail

export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"
export GIT_SSH_COMMAND="ssh -o BatchMode=yes -o ConnectTimeout=15"
REPO="/Users/sam/01-ai-lab/all-in-one/Learning"

log() {
  printf '[%s] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$1"
}

cd "$REPO"

if [[ "$(git branch --show-current)" != "main" ]]; then
  log "自动备份已暂停：当前不在 main 分支。"
  exit 1
fi

if [[ -n "$(git status --porcelain)" ]]; then
  git add -A
  git commit -m "backup: learning data $(date '+%Y-%m-%d %H:%M:%S')"
  log "本地变更已提交。"
else
  log "没有新的本地变更。"
fi

if git push origin main; then
  log "GitHub 备份完成。"
else
  log "GitHub 推送失败；数据仍保存在本地，下次将自动重试。"
  exit 1
fi
