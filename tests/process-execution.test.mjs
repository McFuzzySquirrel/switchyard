import assert from "node:assert/strict";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { executeProcess, runProcess } from "../src/index.ts";

async function makeScript(directory, name, content) {
  const path = join(directory, name);
  await writeFile(path, `#!/bin/sh\n${content}\n`);
  await chmod(path, 0o755);
  return path;
}

test("executeProcess captures bounded output and applies environment policy", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "switchyard-execution-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const script = await makeScript(
    directory,
    "echo.sh",
    'printf "stdout:%s:%s" "$VISIBLE" "$SECRET"; printf "key=$SECRET" >&2',
  );

  const result = await executeProcess(script, [], {
    task: "ignored by the process boundary",
    environmentPolicy: { inherit: false, allow: ["VISIBLE"] },
    env: { VISIBLE: "yes", SECRET: "TOKEN_123" },
    maxOutputLength: 12,
    nonInteractive: true,
  });

  assert.equal(result.succeeded, true);
  assert.equal(result.status, "succeeded");
  assert.equal(result.failureCategory, "none");
  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout.length <= 12, true);
  assert.equal(result.stderr.length <= 12, true);
  assert.equal(result.stdoutTruncated, true);
  assert.equal(result.stderrTruncated, true);
});

test("executeProcess distinguishes nonzero exit, timeout, cancellation, and dry run", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "switchyard-execution-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const fail = await makeScript(directory, "fail.sh", 'echo "secret=TOKEN_123" >&2; exit 7');
  const slow = await makeScript(directory, "slow.sh", "sleep 2");

  const failed = await executeProcess(fail, [], { task: "fail" });
  assert.equal(failed.status, "failed");
  assert.equal(failed.failureCategory, "execution-failure");
  assert.equal(failed.exitCode, 7);
  assert.equal(failed.error?.includes("TOKEN_123"), false);

  const timedOut = await executeProcess(slow, [], { task: "timeout", timeoutMs: 50 });
  assert.equal(timedOut.status, "timed-out");
  assert.equal(timedOut.failureCategory, "timeout");
  assert.equal(timedOut.exitCode, null);

  const controller = new AbortController();
  const cancelledPromise = executeProcess(slow, [], {
    task: "cancel",
    signal: controller.signal,
  });
  setTimeout(() => controller.abort(), 50);
  const cancelled = await cancelledPromise;
  assert.equal(cancelled.status, "cancelled");
  assert.equal(cancelled.failureCategory, "cancelled");

  const dryRun = await runProcess({
    executable: fail,
    args: [],
    request: { task: "dry", dryRun: true },
  });
  assert.equal(dryRun.status, "dry-run");
  assert.equal(dryRun.exitCode, null);
});

test("executeProcess reports a missing executable without throwing", async () => {
  const result = await executeProcess("/nonexistent/switchyard-executable", [], {
    task: "missing",
  });
  assert.equal(result.status, "unavailable");
  assert.equal(result.failureCategory, "unavailable");
  assert.equal(result.exitCode, null);
  assert.ok(result.error);
});
