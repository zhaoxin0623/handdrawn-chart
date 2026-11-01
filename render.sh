#!/usr/bin/env bash
# render.sh <dir> <name>
# Reads <dir>/<name>.svg width/height and screenshots to <dir>/<name>.png via Chrome headless.
# Works on macOS bash 3.2 (no GNU-only flags; no sed -i).
set -e
DIR="${1:?usage: render.sh <dir> <name>}"
NAME="${2:?usage: render.sh <dir> <name>}"
SVG="$DIR/$NAME.svg"

if [ ! -f "$SVG" ]; then
  echo "error: missing $SVG" >&2
  exit 1
fi

# Resolve absolute path (macOS bash 3.2 friendly)
case "$SVG" in
  /*) ABS_SVG="$SVG" ;;
  *) ABS_SVG="$(pwd)/$SVG" ;;
esac
case "$DIR" in
  /*) ABS_DIR="$DIR" ;;
  *) ABS_DIR="$(pwd)/$DIR" ;;
esac

# Parse width/height from <svg ... width="W" height="H" ...>
WH=$(node -e '
const fs=require("fs");
const s=fs.readFileSync(process.argv[1],"utf8");
const w=(s.match(/\bwidth="([0-9.]+)"/)||[])[1];
const h=(s.match(/\bheight="([0-9.]+)"/)||[])[1];
if(!w||!h){console.error("could not parse width/height"); process.exit(1)}
console.log(Math.ceil(Number(w))+" "+Math.ceil(Number(h)));
' "$ABS_SVG")
W=$(echo "$WH" | cut -d' ' -f1)
H=$(echo "$WH" | cut -d' ' -f2)

# CHROME env wins. Else /usr/bin/google-chrome, else macOS Chrome.app.
if [ -n "$CHROME" ]; then
  CHROME_BIN="$CHROME"
elif [ -x /usr/bin/google-chrome ]; then
  CHROME_BIN=/usr/bin/google-chrome
elif [ -x "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" ]; then
  CHROME_BIN="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
else
  echo "error: Chrome not found; set CHROME env var" >&2
  exit 1
fi

TMP="$ABS_DIR/.chrome-profile-$$"
mkdir -p "$TMP"
cleanup() { rm -rf "$TMP"; }
trap cleanup EXIT

# --no-sandbox / --disable-dev-shm-usage help in containers.
# --virtual-time-budget avoids hanging on font/network waits.
"$CHROME_BIN" \
  --headless=new \
  --no-sandbox \
  --disable-dev-shm-usage \
  --disable-gpu \
  --virtual-time-budget=20000 \
  --run-all-compositor-stages-before-draw \
  --hide-scrollbars \
  --user-data-dir="$TMP" \
  --window-size="$W,$H" \
  --screenshot="$ABS_DIR/$NAME.png" \
  "file://$ABS_SVG"

echo "wrote $DIR/$NAME.png (${W}x${H})"
