#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
WORK_DIR="$(mktemp -d "${TMPDIR:-/tmp}/switchyard-fork-routing.XXXXXX")"
REGISTRY_PATH="$WORK_DIR/registry.json"
DISCOVERY_JSON="$WORK_DIR/discovery.json"
RUN_JSON="$WORK_DIR/run.json"

cleanup() {
  rm -rf -- "$WORK_DIR"
}
trap cleanup EXIT

cd "$ROOT_DIR"

if ! command -v opencode >/dev/null 2>&1; then
  printf 'OpenCode CLI is required but was not found on PATH.\n' >&2
  exit 2
fi

node -e 'if (Number(process.versions.node.split(".")[0]) < 24) { console.error("Node.js 24 or newer is required."); process.exit(2); }'

printf '%s\n' \
  'routing-notes.txt' > "$WORK_DIR/routing-notes.txt"

printf '\n== 1. Discover the fork capability ==\n'
npm run --silent switchyard -- discover \
  --refresh \
  --registry "$REGISTRY_PATH" \
  --json > "$DISCOVERY_JSON"

node - "$DISCOVERY_JSON" <<'NODE'
const fs = require("node:fs");
const result = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
if (result.status !== "success") {
  throw new Error(`Discovery did not succeed: ${result.status}`);
}
const opencode = result.harnesses.find((item) => item.id === "opencode");
if (!opencode || opencode.status !== "available") {
  throw new Error("OpenCode is unavailable");
}
if (!opencode.capabilities.some((item) => item.capability === "fork")) {
  throw new Error("OpenCode did not advertise the fork capability");
}
console.log(`opencode: available (${opencode.version ?? "version unknown"})`);
console.log("fork: observed");
NODE

printf '\n== 2. Route a prompt requiring fork ==\n'
npm run --silent switchyard -- prompt \
  --registry "$REGISTRY_PATH" \
  --requires=fork \
  --cwd "$WORK_DIR" \
  --timeout-ms 180000 \
  --json \
  'This is a routing demonstration. Inspect routing-notes.txt in the current disposable workspace, report its contents, and do not modify any files. The required capability for this task is fork.' \
  > "$RUN_JSON"

node - "$RUN_JSON" "$WORK_DIR/routing-notes.txt" <<'NODE'
const fs = require("node:fs");
const result = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
if (
  result.status !== "success" ||
  result.selectedHarness !== "opencode" ||
  result.execution?.status !== "succeeded"
) {
  throw new Error(`Fork capability routing did not execute through OpenCode: ${result.status}`);
}
if (fs.readFileSync(process.argv[3], "utf8").trim() !== "routing-notes.txt") {
  throw new Error("The disposable workspace changed unexpectedly");
}
console.log(`selected=${result.selectedHarness}`);
console.log(`requirements=${result.requirements.requires.join(",")}`);
console.log(`execution=${result.execution.status}`);
console.log(result.execution.stdout.trim());
NODE

printf '\nFork capability routing exercise completed successfully.\n'
