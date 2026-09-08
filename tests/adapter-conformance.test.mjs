import assert from "node:assert/strict";
import { access, chmod, copyFile, mkdtemp, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  HarnessAdapterRegistry,
  UnsupportedOperationError,
  assertOperationSupport,
  isOperationSupport,
  validateOperationSupport,
  createBuiltInHarnessAdapterRegistry,
  createBuiltInHarnessAdapters,
  createGitHubCopilotAdapter,
  createOpenCodeAdapter,
  createStubHarnessAdapter,
} from "../src/index.ts";

const observedAt = "2026-09-07T19:00:00.000Z";
const fixedClock = () => new Date(observedAt);

test("validates the closed operation-support schema", () => {
  const support = {
    discover: true,
    verify: false,
    execute: true,
    resume: false,
    fork: false,
  };

  const result = validateOperationSupport(support);
  assert.equal(result.success, true);
  assert.equal(isOperationSupport(support), true);
  if (result.success) {
    assert.deepEqual(result.value, support);
    assert.notEqual(result.value, support);
  }

  for (const invalid of [
    { ...support, launch: true },
    { ...support, execute: "yes" },
    { discover: true },
    null,
  ]) {
    assert.equal(validateOperationSupport(invalid).success, false);
    assert.equal(isOperationSupport(invalid), false);
  }

  assert.deepEqual(assertOperationSupport(support), support);
  assert.throws(
    () => assertOperationSupport({ ...support, verify: 1 }),
    /\$\.verify must be a boolean/,
  );
});

test("registry rejects adapters with malformed operation support", () => {
  const adapter = createStubHarnessAdapter({ id: "invalid-support" });
  const invalid = { ...adapter, supportedOperations: { discover: true } };
  const registry = new HarnessAdapterRegistry();

  assert.throws(
    () => registry.register(invalid),
    /\$\.verify is required/,
  );
});

async function makeScript(directory, name, content) {
  const path = join(directory, `${name}.mjs`);
  await writeFile(path, `#!/usr/bin/env node\n${content}\n`);
  await chmod(path, 0o755);
  return path;
}

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function installConformanceFixture(directory, mode = "available") {
  const fixture = join(directory, "fixture-harness.mjs");
  await copyFile(
    new URL("./fixtures/adapters/conformance-harness.mjs", import.meta.url),
    fixture,
  );
  await chmod(fixture, 0o755);
  return {
    executable: fixture,
    env: {
      ...process.env,
      SWITCHYARD_FIXTURE_MODE: mode,
    },
  };
}

test("registers a stub HarnessAdapter through the shared registry with no matcher changes", () => {
  const stub = createStubHarnessAdapter({ id: "stub-conformance" });
  const registry = new HarnessAdapterRegistry();

  // Registration uses the exact same registry class and `register`/`get`/`list`
  // surface as the built-in adapters below; no adapter-specific branching.
  registry.register(stub);
  assert.equal(registry.get("stub-conformance"), stub);
  assert.deepEqual(registry.list().map((adapter) => adapter.id), ["stub-conformance"]);

  assert.throws(() => registry.register(stub), /already registered/);
});

test("built-in adapters register into the same HarnessAdapterRegistry as a stub", () => {
  const stub = createStubHarnessAdapter({ id: "stub-alongside-builtins" });
  const registry = createBuiltInHarnessAdapterRegistry();
  registry.register(stub);

  assert.deepEqual(registry.list().map((adapter) => adapter.id).sort(), [
    "copilot",
    "opencode",
    "stub-alongside-builtins",
  ]);
});

test("stub adapter exercises discover, verify, execute, and resume with one consistent executable", async () => {
  const stub = createStubHarnessAdapter({
    id: "stub-flow",
    executable: "/fixtures/stub-flow",
    now: fixedClock,
  });

  const profile = await stub.discover();
  assert.equal(profile.executable, "/fixtures/stub-flow");
  assert.equal(profile.status, "available");

  const verification = await stub.verify(["headless"], {});
  assert.deepEqual(verification, [
    {
      schemaVersion: 1,
      capability: "headless",
      status: "passed",
      startedAt: observedAt,
      completedAt: observedAt,
    },
  ]);

  const execution = await stub.execute({ task: "run tests" });
  assert.equal(execution.succeeded, true);
  assert.equal(execution.status, "succeeded");
  assert.equal(execution.failureCategory, "none");
  assert.equal(execution.exitCode, 0);
  assert.equal(execution.stdout, "stub executed: run tests");
  assert.equal(execution.stdoutTruncated, false);
  assert.equal(execution.stderrTruncated, false);

  const dryRun = await stub.execute({ task: "run tests", dryRun: true });
  assert.equal(dryRun.succeeded, false);
  assert.equal(dryRun.status, "dry-run");
  assert.equal(dryRun.failureCategory, "none");
  assert.equal(dryRun.exitCode, null);
  assert.equal(dryRun.stdout, "");

  const resumed = await stub.resume({ sessionId: "session-1" });
  assert.equal(resumed.succeeded, true);
  assert.match(resumed.stdout, /session-1/);

  // Every recorded call agrees on the same resolved executable: an override
  // is not allowed to reach one operation and not another.
  assert.deepEqual(
    stub.calls.map((call) => call.executable),
    Array(5).fill("/fixtures/stub-flow"),
  );
  assert.deepEqual(
    stub.calls.map((call) => call.operation),
    ["discover", "verify", "execute", "execute", "resume"],
  );
});

test("stub adapter fails an unsupported operation before recording any call", async () => {
  const stub = createStubHarnessAdapter({ id: "stub-fork-unsupported" });

  assert.deepEqual(stub.supportedOperations, {
    discover: true,
    verify: true,
    execute: true,
    resume: true,
    fork: false,
  });

  await assert.rejects(
    () => stub.fork({ sessionId: "session-1" }),
    (error) => {
      assert.ok(error instanceof UnsupportedOperationError);
      assert.equal(error.adapterId, "stub-fork-unsupported");
      assert.equal(error.operation, "fork");
      return true;
    },
  );

  assert.deepEqual(stub.calls, []);
});

test("a stub can be configured to support fork, proving support is per-instance, not hardcoded", async () => {
  const stub = createStubHarnessAdapter({
    id: "stub-fork-supported",
    supportedOperations: { fork: true },
  });

  const forked = await stub.fork({ sessionId: "session-9" });
  assert.match(forked.sessionId, /session-9/);
  assert.deepEqual(
    stub.calls.map((call) => call.operation),
    ["fork"],
  );
});

test("a checked-in executable fixture exercises discovery success and malformed output", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "switchyard-adapter-fixture-"));
  t.after(() => rm(directory, { recursive: true, force: true }));

  const available = await installConformanceFixture(directory);
  const availableProfile = await createOpenCodeAdapter({
    executable: available.executable,
    env: available.env,
    now: fixedClock,
  }).discover();
  assert.equal(availableProfile.status, "available");
  assert.equal(availableProfile.version, "1.0.0");
  assert.deepEqual(
    availableProfile.capabilities.map((observation) => observation.capability),
    ["model-selection", "continue"],
  );

  const malformed = await installConformanceFixture(directory, "malformed");
  const malformedProfile = await createOpenCodeAdapter({
    executable: malformed.executable,
    env: malformed.env,
    now: fixedClock,
  }).discover();
  assert.equal(malformedProfile.status, "malformed");
  assert.equal(malformedProfile.capabilities.length, 0);
  assert.equal(malformedProfile.diagnostics?.[0].code, "probe-malformed");

  const failing = await installConformanceFixture(directory, "failure");
  const failingProfile = await createOpenCodeAdapter({
    executable: failing.executable,
    env: failing.env,
    now: fixedClock,
  }).discover();
  assert.equal(failingProfile.status, "unavailable");
  assert.equal(failingProfile.capabilities.length, 0);
  assert.equal(failingProfile.diagnostics?.[0].code, "probe-unavailable");
});

test("the executable fixture executes a prompt through the provider adapter", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "switchyard-adapter-launch-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const sentinel = join(directory, "launched.txt");
  const fixture = await installConformanceFixture(directory);
  const adapter = createOpenCodeAdapter({
    executable: fixture.executable,
    env: {
      ...fixture.env,
      SWITCHYARD_FIXTURE_SENTINEL: sentinel,
    },
    now: fixedClock,
  });

  const result = await adapter.execute({ task: "launch the prompt" });
  assert.equal(result.succeeded, true);
  assert.equal(await exists(sentinel), true);
});

for (const [label, createAdapter, command] of [
  ["OpenCode", createOpenCodeAdapter, "opencode"],
  ["GitHub Copilot", createGitHubCopilotAdapter, "copilot"],
]) {
  test(`${label} built-in adapter supports discovery and prompt execution`, async (t) => {
    const directory = await mkdtemp(join(tmpdir(), "switchyard-adapter-conformance-"));
    t.after(() => rm(directory, { recursive: true, force: true }));
    const sentinel = join(directory, "launched.txt");
    // If any adapter method spawns this script, it proves execution reached
    // the vendor process; the sentinel file's absence proves it did not.
    const executable = await makeScript(
      directory,
      command,
      `
import { writeFileSync } from "node:fs";
switch (process.argv[2]) {
 case "--version":
   console.log("${command} 1.0.0");
   break;
 case "--help":
   console.log("Usage: ${command}");
   console.log("Options: --model --resume --prompt --continue");
   break;
 default:
   writeFileSync(${JSON.stringify(sentinel)}, "launched\\n");
}`,
   );

    const adapter = createAdapter({ executable, env: { PATH: "" }, now: fixedClock });

      assert.deepEqual(adapter.supportedOperations, {
      discover: true,
      verify: false,
        execute: true,
      resume: false,
      fork: false,
    });

    const profile = await adapter.discover();
    assert.equal(profile.status, "available");
    assert.equal(profile.executable, executable);
    assert.equal(profile.executableSource, "override");

    const execution = await adapter.execute({ task: "implement feature" });
    assert.equal(execution.succeeded, true);
    assert.equal(await exists(sentinel), true);
    await unlink(sentinel);

    for (const [operation, invoke] of [
      ["verify", () => adapter.verify(["headless"], {})],
      ["resume", () => adapter.resume({ sessionId: "s1" })],
      ["fork", () => adapter.fork({ sessionId: "s1" })],
    ]) {
      await assert.rejects(
        invoke,
        (error) => {
          assert.ok(error instanceof UnsupportedOperationError);
          assert.equal(error.adapterId, command);
          assert.equal(error.operation, operation);
          return true;
        },
        `${operation} should reject with UnsupportedOperationError`,
      );
    }

    // The unsupported operations above must fail before any process launch.
    assert.equal(await exists(sentinel), false);
  });

  test(`${label} built-in adapter applies the same executable override to discover as the factory receives`, async (t) => {
    const directory = await mkdtemp(join(tmpdir(), "switchyard-adapter-override-"));
    t.after(() => rm(directory, { recursive: true, force: true }));
   const override = await makeScript(
     directory,
     `custom-${command}`,
     `
if (process.argv[2] === "--version") console.log("${command} 2.0.0");
else if (process.argv[2] === "--help") console.log("Usage: ${command}");
else process.exitCode = 32;`,
    );

    const adapter = createAdapter({ executable: override, env: { PATH: "" }, now: fixedClock });
    const profile = await adapter.discover();
    assert.equal(profile.executable, override);
    assert.equal(profile.executableSource, "override");
    assert.equal(profile.version, "2.0.0");
  });

  test(`${label} built-in adapter preserves normalized configured executable source`, async (t) => {
    const directory = await mkdtemp(join(tmpdir(), "switchyard-adapter-configured-"));
    t.after(() => rm(directory, { recursive: true, force: true }));
   const configured = await makeScript(
     directory,
     `configured-${command}`,
     `
if (process.argv[2] === "--version") console.log("${command} 3.0.0");
else if (process.argv[2] === "--help") console.log("Usage: ${command}");
else process.exitCode = 32;`,
    );

    const adapter = createAdapter({
      executable: configured,
      executableSource: "configured",
      env: { PATH: "" },
      now: fixedClock,
    });
    const profile = await adapter.discover();
    assert.equal(profile.executable, configured);
    assert.equal(profile.executableSource, "configured");
    assert.equal(profile.version, "3.0.0");
  });
}

test("createBuiltInHarnessAdapters resolves each harness's configuration independently", () => {
  const [opencode, copilot] = createBuiltInHarnessAdapters({
    opencode: { executable: "/custom/opencode" },
    copilot: { executable: "/custom/copilot" },
  });
  assert.equal(opencode.id, "opencode");
  assert.equal(copilot.id, "copilot");
});
