#!/bin/zsh
set -euo pipefail

export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"
export GIT_SSH_COMMAND="ssh -o BatchMode=yes -o ConnectTimeout=15"
REMOTE="git@github.com:yangxiao-ca/all-in-one-resources.git"
TEMP_ROOT="$(mktemp -d)"
RESTORE_DIR="$TEMP_ROOT/Learning"

cleanup() {
  rm -rf "$TEMP_ROOT"
}
trap cleanup EXIT

git clone --quiet --branch main --single-branch "$REMOTE" "$RESTORE_DIR"
/opt/homebrew/bin/node - "$RESTORE_DIR" <<'NODE'
const fs = require("node:fs");
const path = require("node:path");
const root = process.argv[2];
const indexPath = path.join(root, "_系统索引", "courses-index.json");
const index = JSON.parse(fs.readFileSync(indexPath, "utf8"));
if (!Array.isArray(index.courses)) throw new Error("课程索引格式无效");
for (const course of index.courses) {
  if (!course.filePath || !fs.existsSync(path.join(root, course.filePath))) {
    throw new Error(`课程文件缺失：${course.title || course.id}`);
  }
}
console.log(`GitHub 恢复验证通过：${index.courses.length} 门课程及对应文件均存在。`);
NODE
