import assert from "node:assert/strict";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  boundExcerpt,
  extractVersion,
  isHelpOutput,
  probeExecutable,
  probeHarnessMetadata,
  probeHelp,
  probeVersion,
  redactSecrets,
  stripAnsi,
} from "../src/index.ts";

async function makeScript(directory, name, content, mode = 0o755) {
  const path = join(directory, name);
  await writeFile(path, `#!/bin/sh\n${content}\n`);
  await chmod(path, mode);
  return path;
}

test("stripAnsi, redactSecrets, boundExcerpt, extractVersion, and isHelpOutput helpers", () => {
  assert.equal(stripAnsi("\u001b[31mHello\u001b[0m World"), "Hello World");
  assert.equal(
    redactSecrets("Bearer token=abc123secret password=xyz key=999"),
    "Bearer [REDACTED] [REDACTED] [REDACTED]",
  );

  const truncated = boundExcerpt("A".repeat(100), 20);
  assert.ok(truncated.includes("[truncated]"));
  assert.ok(truncated.length <= 20);

  assert.equal(extractVersion("opencode version 1.18.28"), "1.18.28");
  assert.equal(extractVersion("github copilot cli v1.0.83 (2026-09-01)"), "1.0.83");
  assert.equal(extractVersion("v2.4.0-rc.1"), "2.4.0-rc.1");
  assert.equal(extractVersion("no version here"), undefined);

  assert.ok(isHelpOutput("Usage: switchyard [options] [command]"));
  assert.ok(isHelpOutput("Commands:\n  run   Execute a task"));
  assert.equal(isHelpOutput("Random text output"), false);
});

test("probeExecutable captures stdout, exit code, duration, and bounded output", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "switchyard-probe-"));
  t.after(() => rm(dir, { recursive: true, force: true }));

  const script = await makeScript(dir, "echo.sh", 'echo "out: $1"');
  const result = await probeExecutable(script, { args: ["hello"] });

  assert.equal(result.success, true);
  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout.trim(), "out: hello");
  assert.equal(result.timedOut, false);
  assert.ok(result.durationMs >= 0);
});

test("probeExecutable handles missing or non-executable files gracefully", async () => {
  const result = await probeExecutable("/nonexistent/binary/path");
  assert.equal(result.success, false);
  assert.equal(result.exitCode, null);
  assert.equal(result.timedOut, false);
  assert.ok(result.error !== undefined);
});

test("probeExecutable reports an already-aborted probe without spawning", async () => {
  const controller = new AbortController();
  controller.abort();

  const result = await probeExecutable("/nonexistent/binary/path", {
    signal: controller.signal,
  });

  assert.equal(result.success, false);
  assert.equal(result.exitCode, null);
  assert.equal(result.timedOut, false);
  assert.equal(result.error, "Probe execution was aborted");
});

test("probeExecutable handles timeouts safely and sets timedOut", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "switchyard-probe-"));
  t.after(() => rm(dir, { recursive: true, force: true }));

  const script = await makeScript(dir, "sleep.sh", "sleep 2");
  const result = await probeExecutable(script, { timeoutMs: 100 });

  assert.equal(result.success, false);
  assert.equal(result.timedOut, true);
  assert.ok(result.error?.includes("timed out"));
});

test("probeExecutable truncates output exceeding maxOutputLength", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "switchyard-probe-"));
  t.after(() => rm(dir, { recursive: true, force: true }));

  const script = await makeScript(dir, "large.sh", 'printf "A%.0s" $(seq 1 500)');
  const result = await probeExecutable(script, { maxOutputLength: 50 });

  assert.ok(result.stdout.includes("[truncated]"));
  assert.ok(result.excerpt.includes("[truncated]"));
});

test("probeVersion tries candidate args and extracts version evidence", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "switchyard-probe-"));
  t.after(() => rm(dir, { recursive: true, force: true }));

  const script = await makeScript(
    dir,
    "version-tool.sh",
    'if [ "$1" = "--version" ]; then echo "tool-cli 2.5.1"; exit 0; fi; exit 1',
  );

  const res = await probeVersion(script);
  assert.equal(res.version, "2.5.1");
  assert.ok(res.evidence);
  assert.equal(res.evidence.source, "version");
  assert.equal(res.evidence.reference, "--version");
  assert.equal(res.evidence.excerpt, "2.5.1");
  assert.ok(res.evidence.capturedAt);
});

test("probeHelp captures help output evidence", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "switchyard-probe-"));
  t.after(() => rm(dir, { recursive: true, force: true }));

  const script = await makeScript(
    dir,
    "help-tool.sh",
    'if [ "$1" = "--help" ]; then echo "Usage: tool [options]"; echo "  --run  Run task"; exit 0; fi; exit 1',
  );

  const res = await probeHelp(script);
  assert.ok(res.helpText.includes("Usage: tool [options]"));
  assert.ok(res.evidence);
  assert.equal(res.evidence.source, "help");
  assert.equal(res.evidence.reference, "--help");
  assert.ok(res.evidence.capturedAt);
});

test("probeHarnessMetadata consolidates version and help probing into profile evidence", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "switchyard-probe-"));
  t.after(() => rm(dir, { recursive: true, force: true }));

  const script = await makeScript(
    dir,
    "harness.sh",
    `
case "$1" in
  --version) echo "harness-cli 1.0.0"; exit 0 ;;
  --help) echo "Usage: harness [options]"; exit 0 ;;
  *) exit 1 ;;
esac
`,
  );

  const meta = await probeHarnessMetadata(script);
  assert.equal(meta.status, "available");
  assert.equal(meta.version, "1.0.0");
  assert.ok(meta.helpText?.includes("Usage: harness"));
  assert.equal(meta.evidences.length, 2);
  assert.equal(meta.evidences[0].source, "version");
  assert.equal(meta.evidences[1].source, "help");
});

test("probeHarnessMetadata returns unavailable status for failing binaries", async () => {
  const meta = await probeHarnessMetadata("/invalid/executable/path");
  assert.equal(meta.status, "unavailable");
  assert.equal(meta.version, undefined);
  assert.equal(meta.evidences.length, 0);
  assert.ok(meta.diagnostic);
});
