#!/bin/zsh
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
APP_DIR="$HOME/Desktop/学习驾驶舱.app"
CONTENTS_DIR="$APP_DIR/Contents"
ICONSET_DIR="$(mktemp -d)/LearningCockpit.iconset"
SOURCE_ICON="$PROJECT_ROOT/icons/icon-512.png"

cleanup() {
  rm -rf "$(dirname "$ICONSET_DIR")"
}
trap cleanup EXIT

mkdir -p "$CONTENTS_DIR/MacOS" "$CONTENTS_DIR/Resources" "$ICONSET_DIR"
cp "$PROJECT_ROOT/deploy/desktop/Info.plist" "$CONTENTS_DIR/Info.plist"
cp "$PROJECT_ROOT/deploy/desktop/open-learning" "$CONTENTS_DIR/MacOS/open-learning"
cp "$PROJECT_ROOT/deploy/desktop/run-service" "$CONTENTS_DIR/MacOS/run-service"
chmod 755 "$CONTENTS_DIR/MacOS/open-learning" "$CONTENTS_DIR/MacOS/run-service"

sips -z 16 16 "$SOURCE_ICON" --out "$ICONSET_DIR/icon_16x16.png" >/dev/null
sips -z 32 32 "$SOURCE_ICON" --out "$ICONSET_DIR/icon_16x16@2x.png" >/dev/null
sips -z 32 32 "$SOURCE_ICON" --out "$ICONSET_DIR/icon_32x32.png" >/dev/null
sips -z 64 64 "$SOURCE_ICON" --out "$ICONSET_DIR/icon_32x32@2x.png" >/dev/null
sips -z 128 128 "$SOURCE_ICON" --out "$ICONSET_DIR/icon_128x128.png" >/dev/null
sips -z 256 256 "$SOURCE_ICON" --out "$ICONSET_DIR/icon_128x128@2x.png" >/dev/null
sips -z 256 256 "$SOURCE_ICON" --out "$ICONSET_DIR/icon_256x256.png" >/dev/null
sips -z 512 512 "$SOURCE_ICON" --out "$ICONSET_DIR/icon_256x256@2x.png" >/dev/null
sips -z 512 512 "$SOURCE_ICON" --out "$ICONSET_DIR/icon_512x512.png" >/dev/null
sips -z 1024 1024 "$SOURCE_ICON" --out "$ICONSET_DIR/icon_512x512@2x.png" >/dev/null
iconutil -c icns "$ICONSET_DIR" -o "$CONTENTS_DIR/Resources/LearningCockpit.icns"

touch "$APP_DIR"
printf '桌面应用已安装：%s\n' "$APP_DIR"
