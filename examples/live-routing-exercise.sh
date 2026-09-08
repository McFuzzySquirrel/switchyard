#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
WORK_DIR="$(mktemp -d "${TMPDIR:-/tmp}/switchyard-live-demo.XXXXXX")"
REGISTRY_PATH="$WORK_DIR/registry.json"
DISCOVERY_JSON="$WORK_DIR/discovery.json"
IMPLEMENTATION_JSON="$WORK_DIR/implementation.json"
REVIEW_JSON="$WORK_DIR/review.json"

cleanup() {
  rm -rf -- "$WORK_DIR"
}
trap cleanup EXIT

cd "$ROOT_DIR"

if ! command -v opencode >/dev/null 2>&1; then
  printf 'OpenCode CLI is required but was not found on PATH.\n' >&2
  exit 2
fi
if ! command -v copilot >/dev/null 2>&1; then
  printf 'GitHub Copilot CLI is required but was not found on PATH.\n' >&2
  exit 2
fi

node -e 'if (Number(process.versions.node.split(".")[0]) < 24) { console.error("Node.js 24 or newer is required."); process.exit(2); }'

printf 'Creating disposable workspace: %s\n' "$WORK_DIR"
printf '%s\n' \
  'export function average(values) {' \
  '  if (values.length === 0) return 0;' \
  '  return values.reduce((total, value) => total + value, 0) / values.length;' \
  '}' > "$WORK_DIR/score.js"

printf '\n== 1. Discover installed providers ==\n'
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
for (const id of ["opencode", "copilot"]) {
  const harness = result.harnesses.find((item) => item.id === id);
  if (!harness || harness.status !== "available") {
    throw new Error(`Required harness is unavailable: ${id}`);
  }
  if (!harness.capabilities.some((item) => item.capability === "headless")) {
    throw new Error(`Required headless capability is missing: ${id}`);
  }
  console.log(`${id}: available (${harness.version ?? "version unknown"})`);
}
NODE

printf '\n== 2. Route implementation prompt to OpenCode ==\n'
npm run --silent switchyard -- prompt \
  --registry "$REGISTRY_PATH" \
  --requires=headless \
  --preferred-harness=opencode \
  --cwd "$WORK_DIR" \
  --timeout-ms 180000 \
  --json \
  'In the disposable demo workspace, improve score.js by making average reject sparse arrays and validate that every present item is a finite number, throwing a clear TypeError otherwise. Preserve the empty-array behavior and keep the change limited to score.js. Do not access or modify files outside this workspace. Report what you changed.' \
  > "$IMPLEMENTATION_JSON"

node - "$IMPLEMENTATION_JSON" "$WORK_DIR/score.js" <<'NODE'
const fs = require("node:fs");
(async () => {
  const result = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
  if (
    result.status !== "success" ||
    result.selectedHarness !== "opencode" ||
    result.execution?.status !== "succeeded"
  ) {
    throw new Error(`Implementation did not succeed through OpenCode: ${result.status}`);
  }
  const source = fs.readFileSync(process.argv[3], "utf8");
  if (!source.includes("Number.isFinite") || !source.includes("TypeError")) {
    throw new Error("OpenCode did not make the expected validation change");
  }
  const { average } = await import(`file://${process.argv[3]}`);
  if (average([]) !== 0 || average([2, 4]) !== 3) {
    throw new Error("OpenCode changed valid or empty-array behavior");
  }
  let sparseRejected = false;
  try {
    average([, 2]);
  } catch (error) {
    sparseRejected = error instanceof TypeError;
  }
  if (!sparseRejected) {
    throw new Error("OpenCode did not reject sparse arrays");
  }
  console.log(`selected=${result.selectedHarness} status=${result.execution.status}`);
  console.log(result.execution.stdout.trim());
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
NODE

printf '\n== 3. Route review prompt to GitHub Copilot ==\n'
npm run --silent switchyard -- prompt \
  --registry "$REGISTRY_PATH" \
  --requires=headless \
  --preferred-harness=copilot \
  --cwd "$WORK_DIR" \
  --timeout-ms 180000 \
  --json \
  'Review score.js in this disposable workspace as a second-pass code reviewer. Do not modify any files. Check whether average rejects sparse arrays, validates finite numeric inputs, preserves the empty-array behavior, and has any obvious correctness issue. Report findings and a concise verdict. Do not access files outside this workspace.' \
  > "$REVIEW_JSON"

node - "$REVIEW_JSON" <<'NODE'
const fs = require("node:fs");
const result = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
if (
  result.status !== "success" ||
  result.selectedHarness !== "copilot" ||
  result.execution?.status !== "succeeded"
) {
  throw new Error(`Review did not succeed through Copilot: ${result.status}`);
}
console.log(`selected=${result.selectedHarness} status=${result.execution.status}`);
console.log(result.execution.stdout.trim());
NODE

printf '\nLive routing exercise completed successfully.\n'
