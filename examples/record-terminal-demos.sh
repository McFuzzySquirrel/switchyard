#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
OUTPUT_DIR="$ROOT_DIR/docs/examples/media"
WORK_DIR="$(mktemp -d "${TMPDIR:-/tmp}/switchyard-terminal-recording.XXXXXX")"
FRAME_RATE=6

cleanup() {
  rm -rf -- "$WORK_DIR"
}
trap cleanup EXIT

cd "$ROOT_DIR"

for command_name in script ffmpeg python3 fc-match; do
  if ! command -v "$command_name" >/dev/null 2>&1; then
    printf '%s is required to record terminal demos.\n' "$command_name" >&2
    exit 2
  fi
done

node -e 'if (Number(process.versions.node.split(".")[0]) < 24) { console.error("Node.js 24 or newer is required."); process.exit(2); }'
if ! python3 -c 'import PIL' >/dev/null 2>&1; then
  printf 'Python Pillow is required to render terminal frames.\n' >&2
  exit 2
fi

mkdir -p "$OUTPUT_DIR"
FONT_PATH="$(fc-match -f '%{file}' monospace | head -1)"

sanitize_capture() {
  local input="$1"
  local output="$2"
  perl -pe '
    s/\e\[[0-9;?]*[ -\/]*[@-~]//g;
    s#/(?:home|Users)/[^[:space:]/]+/Projects/switchyard#<repo>#g;
    s#/tmp/switchyard-[^[:space:]]+#<temporary-workspace>#g;
    s#/(?:home|Users)/[^[:space:]]+#<home>#g;
    s/^.*(?:AI Credits|Tokens|Resume\s+copilot).*$/[provider usage details redacted]/;
  ' "$input" |
    sed -E 's/[[:space:]]+$//' |
    awk 'length($0) > 180 { print substr($0, 1, 177) "..."; next } { print }' |
    awk 'NF || previous_nonempty < 2 { print; previous_nonempty = NF ? 0 : previous_nonempty + 1 }' |
    tail -n 160 > "$output"
}

render_frames() {
  local capture="$1"
  local frame_dir="$2"
  local title="$3"
  mkdir -p "$frame_dir"

  local line_count
  line_count="$(wc -l < "$capture")"
  if [[ "$line_count" -eq 0 ]]; then
    printf 'Capture was empty for %s.\n' "$title" >&2
    return 1
  fi

  python3 - "$capture" "$frame_dir" "$title" "$FONT_PATH" <<'PY'
import pathlib
import sys

from PIL import Image, ImageDraw, ImageFont

capture, frame_dir, title, font_path = sys.argv[1:]
lines = pathlib.Path(capture).read_text(encoding="utf-8", errors="replace").splitlines()
font = ImageFont.truetype(font_path, 22)
header_font = ImageFont.truetype(font_path, 20)
separator = "─" * 78

for index in range(1, len(lines) + 1):
    visible = lines[max(0, index - 22):index]
    image = Image.new("RGB", (1280, 720), "#0d1117")
    draw = ImageDraw.Draw(image)
    draw.text((36, 24), f"switchyard demo  |  {title}", font=header_font, fill="#58a6ff")
    draw.text((36, 54), separator, font=header_font, fill="#30363d")
    draw.multiline_text((36, 88), "\n".join(visible), font=font, fill="#c9d1d9", spacing=7)
    image.save(pathlib.Path(frame_dir) / f"frame-{index:04d}.png")
PY
}

make_media() {
  local name="$1"
  local title="$2"
  local command_line="$3"
  local raw="$WORK_DIR/$name.raw"
  local capture="$WORK_DIR/$name.capture"
  local frames="$WORK_DIR/$name-frames"

  printf '\nRecording %s...\n' "$title"
  if ! TERM=xterm-256color script -q -e -c "$command_line" "$raw"; then
    printf 'Recording failed for %s; no media was generated.\n' "$title" >&2
    return 1
  fi
  sanitize_capture "$raw" "$capture"
  render_frames "$capture" "$frames" "$title"

  ffmpeg -hide_banner -loglevel error -y \
    -framerate "$FRAME_RATE" \
    -i "$frames/frame-%04d.png" \
    -filter_complex "[0:v]fps=$FRAME_RATE,split[s0][s1];[s0]palettegen=max_colors=256[p];[s1][p]paletteuse" \
    "$OUTPUT_DIR/$name.gif"
  ffmpeg -hide_banner -loglevel error -y \
    -framerate "$FRAME_RATE" \
    -i "$frames/frame-%04d.png" \
    -c:v libx264 \
    -pix_fmt yuv420p \
    -movflags +faststart \
    "$OUTPUT_DIR/$name.mp4"

  printf 'Created %s.gif and %s.mp4\n' "$name" "$name"
}

make_media \
  "live-routing-exercise" \
  "OpenCode implementation -> Copilot review" \
  "./examples/live-routing-exercise.sh"

make_media \
  "fork-capability-routing" \
  "fork capability -> OpenCode" \
  "./examples/fork-capability-routing.sh"

printf '\nTerminal demo media generated in %s\n' "$OUTPUT_DIR"
