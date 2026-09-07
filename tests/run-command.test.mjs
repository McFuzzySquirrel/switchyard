import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  discover,
  run,
  formatRunJson,
  formatRunHuman,
  runInvalidInput,
  RunInputError,
  createStubHarnessAdapter,
  HarnessAdapterRegistry,
  CLI_EXIT_CODES,
  runCli,
} from "../src/index.ts";

const observedAt = "2026-09-07T19:00:00.000Z";
const fixedClock = () => new Date(observedAt);

function profile(id = "fixture", capabilityNames = ["headless"]) {
  const observations = capabilityNames.map((capability) => ({
    schemaVersion: 1,
    capability,
    discovery: {
      status: "observed",
      source: "help",
      observedAt,
      evidence: {
        source: "help",
        excerpt: "Usage: fixture --token=secret",
        capturedAt: observedAt,
        reference: "--help",
      },
    },
    verification: { status: "not-requested" },
  }));
  return {
    schemaVersion: 1,
    id,
    displayName: "Fixture Harness",
    executable: "/tmp/fixture",
    executableSource: "path",
    version: "1.2.3",
    capabilities: observations,
    status: "available",
    lifecycle: "registered",
    availability: { status: "available", checkedAt: observedAt },
    discoveredAt: observedAt,
    updatedAt: observedAt,
  };
}

async function withRegistry(t, capabilityNames = ["headless"]) {
  const directory = await mkdtemp(join(tmpdir(), "switchyard-run-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const registryPath = join(directory, "registry.json");
  await discover({
    registryPath,
    adapters: [{ id: "fixture", discover: async () => profile("fixture", capabilityNames) }],
    now: fixedClock,
  });
  return registryPath;
}

/** Minimal fixture adapter that only implements the operations `run` needs. */
function makeExecutionAdapter(id, executeImpl, supportedOperationsOverride = {}) {
  return {
    id,
    supportedOperations: {
      discover: true,
      verify: true,
      execute: true,
      resume: true,
      fork: true,
      ...supportedOperationsOverride,
    },
    async discover() {
      throw new Error("discover is not used by run");
    },
    async verify() {
      throw new Error("verify is not used by run");
    },
    execute: executeImpl,
    async resume() {
      throw new Error("resume is not used by run");
    },
    async fork() {
      throw new Error("fork is not used by run");
    },
  };
}

test("run executes the routed harness and reports a successful execution result", async (t) => {
  const registryPath = await withRegistry(t);
  const stub = createStubHarnessAdapter({ id: "fixture" });

  const result = await run({
    registryPath,
    requirements: { requires: ["headless"] },
    task: "fix the failing test",
    adapters: [stub],
    now: fixedClock,
  });

  assert.equal(result.command, "run");
  assert.equal(result.status, "success");
  assert.equal(result.selectedHarness, "fixture");
  assert.equal(result.dryRun, false);
  assert.equal(result.execution.succeeded, true);
  assert.equal(result.execution.status, "succeeded");
  assert.match(result.execution.stdout, /fix the failing test/);
  assert.deepEqual(
    stub.calls.map((call) => call.operation),
    ["execute"],
  );

  const json = JSON.parse(formatRunJson(result));
  assert.equal(json.schemaVersion, 1);
  assert.equal(json.status, "success");
  const human = formatRunHuman(result);
  assert.match(human, /Switchyard run/);
  assert.match(human, /Selection: fixture/);
  assert.match(human, /Execution status: succeeded/);
});

test("run accepts a HarnessAdapterRegistry directly", async (t) => {
  const registryPath = await withRegistry(t);
  const registry = new HarnessAdapterRegistry([createStubHarnessAdapter({ id: "fixture" })]);

  const result = await run({
    registryPath,
    requirements: { requires: ["headless"] },
    task: "task via registry",
    adapters: registry,
    now: fixedClock,
  });

  assert.equal(result.status, "success");
});

test("run --dry-run describes the request without launching the task", async (t) => {
  const registryPath = await withRegistry(t);
  const stub = createStubHarnessAdapter({ id: "fixture" });

  const result = await run({
    registryPath,
    requirements: { requires: ["headless"] },
    task: "fix the failing test",
    adapters: [stub],
    dryRun: true,
    now: fixedClock,
  });

  assert.equal(result.status, "dry-run");
  assert.equal(result.dryRun, true);
  assert.equal(result.execution.status, "dry-run");
  assert.equal(result.execution.succeeded, false);
  assert.equal(result.execution.failureCategory, "none");
  assert.equal(result.execution.exitCode, null);
  assert.equal(result.execution.stdout, "");
  assert.deepEqual(
    stub.calls.map((call) => call.operation),
    [],
    "dry-run must not invoke the adapter",
  );
});

test("run reports no-match without selecting or executing any harness", async (t) => {
  const registryPath = await withRegistry(t);

  const result = await run({
    registryPath,
    requirements: { requires: ["mcp"] },
    task: "unreachable task",
    adapters: [],
    now: fixedClock,
  });

  assert.equal(result.status, "no-match");
  assert.equal(result.selectedHarness, null);
  assert.equal(result.selection, null);
  assert.equal(result.execution, null);
});

test("run reports unavailable when the selected harness has no registered adapter", async (t) => {
  const registryPath = await withRegistry(t);

  const result = await run({
    registryPath,
    requirements: { requires: ["headless"] },
    task: "task with no adapter",
    adapters: [],
    now: fixedClock,
  });

  assert.equal(result.status, "unavailable");
  assert.equal(result.selectedHarness, "fixture");
  assert.equal(result.execution.status, "unavailable");
  assert.equal(result.execution.failureCategory, "unavailable");
  assert.match(result.execution.error, /not registered for execution/);
});

test("run rejects launching an adapter that has not declared execute support", async (t) => {
  const registryPath = await withRegistry(t);
  const stub = createStubHarnessAdapter({
    id: "fixture",
    supportedOperations: { execute: false },
  });

  const result = await run({
    registryPath,
    requirements: { requires: ["headless"] },
    task: "task without execute support",
    adapters: [stub],
    now: fixedClock,
  });

  assert.equal(result.status, "unavailable");
  assert.equal(result.execution.failureCategory, "unavailable");
  assert.match(result.execution.error, /does not support the 'execute' operation/);
  assert.deepEqual(stub.calls, [], "an unsupported operation must never be launched");
});

test("run reports execution-failure for a completed but failing process", async (t) => {
  const registryPath = await withRegistry(t);
  const failing = makeExecutionAdapter("fixture", async () => ({
    succeeded: false,
    status: "failed",
    failureCategory: "execution-failure",
    exitCode: 1,
    stdout: "",
    stderr: "boom",
    stdoutTruncated: false,
    stderrTruncated: false,
    durationMs: 5,
    error: "Process exited with code 1",
  }));

  const result = await run({
    registryPath,
    requirements: { requires: ["headless"] },
    task: "task that fails",
    adapters: [failing],
    now: fixedClock,
  });

  assert.equal(result.status, "execution-failure");
  assert.equal(result.execution.exitCode, 1);
  assert.equal(result.execution.stderr, "boom");
});

test("run serializers redact secret-bearing task and execution output", async (t) => {
  const registryPath = await withRegistry(t);
  const secret = "sk-abcdef0123456789";
  const leaking = makeExecutionAdapter("fixture", async () => ({
    succeeded: false,
    status: "failed",
    failureCategory: "execution-failure",
    exitCode: 1,
    stdout: `token=${secret}`,
    stderr: `secret=${secret}`,
    stdoutTruncated: false,
    stderrTruncated: false,
    durationMs: 1,
    error: `failed with token=${secret}`,
  }));

  const result = await run({
    registryPath,
    requirements: { requires: ["headless"] },
    task: `use token=${secret}`,
    adapters: [leaking],
    now: fixedClock,
  });

  const json = formatRunJson(result);
  const human = formatRunHuman(result);
  assert.doesNotMatch(json, new RegExp(secret));
  assert.doesNotMatch(human, new RegExp(secret));
  assert.match(json, /\[REDACTED\]/);
  assert.match(human, /\[REDACTED\]/);
});

test("run reports execution-failure distinctly for timeout and cancellation", async (t) => {
  const registryPath = await withRegistry(t);
  const timedOut = makeExecutionAdapter("fixture", async () => ({
    succeeded: false,
    status: "timed-out",
    failureCategory: "timeout",
    exitCode: null,
    stdout: "",
    stderr: "",
    stdoutTruncated: false,
    stderrTruncated: false,
    durationMs: 30000,
    error: "Process timed out after 30000ms",
  }));

  const result = await run({
    registryPath,
    requirements: { requires: ["headless"] },
    task: "task that times out",
    adapters: [timedOut],
    now: fixedClock,
  });

  assert.equal(result.status, "execution-failure");
  assert.equal(result.execution.status, "timed-out");
  assert.equal(result.execution.failureCategory, "timeout");
});

test("run rejects an empty task before routing runs", async (t) => {
  const registryPath = await withRegistry(t);

  await assert.rejects(
    run({
      registryPath,
      requirements: { requires: ["headless"] },
      task: "   ",
      adapters: [],
      now: fixedClock,
    }),
    (error) => {
      assert.ok(error instanceof RunInputError);
      assert.match(error.message, /task/);
      return true;
    },
  );
});

test("run surfaces invalid requirements as RunInputError", async (t) => {
  const registryPath = await withRegistry(t);

  await assert.rejects(
    run({
      registryPath,
      requirements: { requires: ["headless", "headless"] },
      task: "duplicate requirement",
      adapters: [],
      now: fixedClock,
    }),
    (error) => {
      assert.ok(error instanceof RunInputError);
      const invalid = runInvalidInput(error);
      assert.equal(invalid.status, "invalid-input");
      assert.equal(invalid.error.code, "invalid-input");
      assert.match(formatRunHuman(invalid), /invalid-input/);
      return true;
    },
  );
});

test("CLI run --json executes through the built-in wiring and maps stable exit codes", async (t) => {
  const registryPath = await withRegistry(t);
  const stub = createStubHarnessAdapter({ id: "fixture" });

  const stdout = [];
  const exitCode = await runCli(
    ["run", "--requires=headless", "--registry", registryPath, "--json", "fix", "the", "bug"],
    { stdout: (text) => stdout.push(text), stderr: () => {} },
    undefined,
    [stub],
  );

  assert.equal(exitCode, CLI_EXIT_CODES.success);
  const payload = JSON.parse(stdout.join(""));
  assert.equal(payload.command, "run");
  assert.equal(payload.status, "success");
  assert.equal(payload.task, "fix the bug");
  assert.equal(payload.policy.allowFallback, false);
  assert.deepEqual(payload.policy.attempts.map((attempt) => attempt.harnessId), ["fixture"]);
  assert.match(payload.execution.stdout, /fix the bug/);
});

test("CLI run --dry-run never launches the selected harness", async (t) => {
  const registryPath = await withRegistry(t);
  const stub = createStubHarnessAdapter({ id: "fixture" });

  const stdout = [];
  const exitCode = await runCli(
    ["run", "--requires=headless", "--registry", registryPath, "--dry-run", "--json", "task"],
    { stdout: (text) => stdout.push(text), stderr: () => {} },
    undefined,
    [stub],
  );

  assert.equal(exitCode, CLI_EXIT_CODES.success);
  const payload = JSON.parse(stdout.join(""));
  assert.equal(payload.status, "dry-run");
  assert.deepEqual(
    stub.calls.map((call) => call.operation),
    [],
    "dry-run must not invoke the adapter",
  );
});

test("CLI run reports the unavailable exit category for an unregistered harness", async (t) => {
  const registryPath = await withRegistry(t);

  const stdout = [];
  const exitCode = await runCli(
    ["run", "--requires=headless", "--registry", registryPath, "--json", "task"],
    { stdout: (text) => stdout.push(text), stderr: () => {} },
    undefined,
    [],
  );

  assert.equal(exitCode, CLI_EXIT_CODES.unavailable);
  const payload = JSON.parse(stdout.join(""));
  assert.equal(payload.status, "unavailable");
});

test("CLI run reports the no-match exit category without executing anything", async (t) => {
  const registryPath = await withRegistry(t);

  const stdout = [];
  const exitCode = await runCli(
    ["run", "--requires=mcp", "--registry", registryPath, "--json", "task"],
    { stdout: (text) => stdout.push(text), stderr: () => {} },
    undefined,
    [],
  );

  assert.equal(exitCode, CLI_EXIT_CODES.noMatch);
  const payload = JSON.parse(stdout.join(""));
  assert.equal(payload.status, "no-match");
});

test("CLI run reports the failure exit category for a completed but failing execution", async (t) => {
  const registryPath = await withRegistry(t);
  const failing = makeExecutionAdapter("fixture", async () => ({
    succeeded: false,
    status: "failed",
    failureCategory: "execution-failure",
    exitCode: 7,
    stdout: "",
    stderr: "boom",
    stdoutTruncated: false,
    stderrTruncated: false,
    durationMs: 3,
    error: "Process exited with code 7",
  }));

  const stdout = [];
  const exitCode = await runCli(
    ["run", "--requires=headless", "--registry", registryPath, "--json", "task"],
    { stdout: (text) => stdout.push(text), stderr: () => {} },
    undefined,
    [failing],
  );

  assert.equal(exitCode, CLI_EXIT_CODES.failure);
  const payload = JSON.parse(stdout.join(""));
  assert.equal(payload.status, "execution-failure");
  assert.equal(payload.execution.exitCode, 7);
});

test("CLI run without a task is a stable invalid-input error", async (t) => {
  const registryPath = await withRegistry(t);

  const stdout = [];
  const exitCode = await runCli(
    ["run", "--requires=headless", "--registry", registryPath, "--json"],
    { stdout: (text) => stdout.push(text), stderr: () => {} },
  );

  assert.equal(exitCode, CLI_EXIT_CODES.invalidInput);
  const payload = JSON.parse(stdout.join(""));
  assert.equal(payload.command, "run");
  assert.equal(payload.status, "invalid-input");
});

test("CLI rejects run-only options for other commands", async () => {
  const stderr = [];
  const exitCode = await runCli(
    ["explain", "--requires=headless", "--dry-run"],
    { stderr: (text) => stderr.push(text) },
  );

  assert.equal(exitCode, CLI_EXIT_CODES.invalidInput);
  assert.match(stderr.join(""), /only supported by the run command/);
});

test("CLI shares --requires and --preferred-harness between explain and run", async (t) => {
  const registryPath = await withRegistry(t);
  const stub = createStubHarnessAdapter({ id: "fixture" });

  const stdout = [];
  const exitCode = await runCli(
    [
      "run",
      "--requires=headless",
      "--preferred-harness=fixture",
      "--registry",
      registryPath,
      "--json",
      "preferred task",
    ],
    { stdout: (text) => stdout.push(text), stderr: () => {} },
    undefined,
    [stub],
  );

  assert.equal(exitCode, CLI_EXIT_CODES.success);
  const payload = JSON.parse(stdout.join(""));
  assert.equal(payload.selectedHarness, "fixture");
  assert.equal(payload.policy.preferredHarness, "fixture");
  assert.equal(payload.policy.attempts[0].selected, true);
});
