import assert from "node:assert/strict";
import test from "node:test";

import {
  createStubHarnessAdapter,
  fork,
  formatSessionJson,
  resume,
  runCli,
} from "../src/index.ts";

test("resume invokes the selected adapter and preserves the session contract", async () => {
  const adapter = createStubHarnessAdapter({
    id: "stub",
    supportedOperations: { resume: true },
  });
  const result = await resume({
    harnessId: "stub",
    sessionId: "session-1",
    task: "continue",
    adapters: [adapter],
  });

  assert.equal(result.status, "success");
  assert.equal(result.execution?.succeeded, true);
  assert.deepEqual(adapter.calls.map((call) => call.operation), ["resume"]);
});

test("fork invokes the selected adapter and returns the new session", async () => {
  const adapter = createStubHarnessAdapter({
    id: "stub",
    supportedOperations: { fork: true },
  });
  const result = await fork({
    harnessId: "stub",
    sessionId: "session-1",
    task: "alternative",
    adapters: [adapter],
  });

  assert.equal(result.status, "success");
  assert.equal(result.fork?.sessionId, "stub-fork-session-1");
  assert.deepEqual(JSON.parse(formatSessionJson(result)).fork, result.fork);
});

test("fork reports unsupported adapters without launching them", async () => {
  const adapter = createStubHarnessAdapter({ id: "stub" });
  const result = await fork({
    harnessId: "stub",
    sessionId: "session-1",
    adapters: [adapter],
  });

  assert.equal(result.status, "unavailable");
  assert.match(result.error, /does not support/);
  assert.deepEqual(adapter.calls, []);
});

test("CLI exposes resume as a top-level JSON command", async () => {
  const stdout = [];
  const stderr = [];
  const adapter = createStubHarnessAdapter({
    id: "stub",
    supportedOperations: { resume: true },
  });
  const exitCode = await runCli(
    ["resume", "--harness=stub", "--session=session-1", "continue", "--json"],
    { stdout: (text) => stdout.push(text), stderr: (text) => stderr.push(text) },
    undefined,
    [adapter],
  );

  assert.equal(exitCode, 0);
  assert.equal(stderr.length, 0);
  assert.equal(JSON.parse(stdout.join("\n")).command, "resume");
});
