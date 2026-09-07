import assert from "node:assert/strict";
import { access, chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  HarnessAdapterRegistry,
  UnsupportedOperationError,
  createBuiltInHarnessAdapterRegistry,
  createBuiltInHarnessAdapters,
  createGitHubCopilotAdapter,
  createOpenCodeAdapter,
  createStubHarnessAdapter,
} from "../src/index.ts";

const observedAt = "2026-09-07T19:00:00.000Z";
const fixedClock = () => new Date(observedAt);

async function makeScript(directory, name, content) {
  const path = join(directory, name);
  await writeFile(path, `#!/bin/sh\n${content}\n`);
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
    { capability: "headless", status: "passed", completedAt: observedAt },
  ]);

  const execution = await stub.execute({ task: "run tests" });
  assert.equal(execution.succeeded, true);
  assert.equal(execution.stdout, "stub executed: run tests");

  const dryRun = await stub.execute({ task: "run tests", dryRun: true });
  assert.equal(dryRun.succeeded, false);
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

for (const [label, createAdapter, command] of [
  ["OpenCode", createOpenCodeAdapter, "opencode"],
  ["GitHub Copilot", createGitHubCopilotAdapter, "copilot"],
]) {
  test(`${label} built-in adapter declares discovery-only support and fails every other operation before launch`, async (t) => {
    const directory = await mkdtemp(join(tmpdir(), "switchyard-adapter-conformance-"));
    t.after(() => rm(directory, { recursive: true, force: true }));
    const sentinel = join(directory, "launched.txt");
    // If any adapter method spawns this script, it proves execution reached
    // the vendor process; the sentinel file's absence proves it did not.
    const executable = await makeScript(
      directory,
      command,
      `
case "$1" in
  --version) echo "${command} 1.0.0"; exit 0 ;;
  --help) echo "Usage: ${command}"; echo "Options: --model --resume --prompt --continue"; exit 0 ;;
  *) touch "${sentinel}"; exit 0 ;;
esac`,
    );

    const adapter = createAdapter({ executable, env: { PATH: "" }, now: fixedClock });

    assert.deepEqual(adapter.supportedOperations, {
      discover: true,
      verify: false,
      execute: false,
      resume: false,
      fork: false,
    });

    const profile = await adapter.discover();
    assert.equal(profile.status, "available");
    assert.equal(profile.executable, executable);
    assert.equal(profile.executableSource, "override");

    for (const [operation, invoke] of [
      ["verify", () => adapter.verify(["headless"], {})],
      ["execute", () => adapter.execute({ task: "implement feature" })],
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

    // The unsupported operations above must fail before any process launch:
    // the sentinel file is only created by the fixture's catch-all branch.
    assert.equal(await exists(sentinel), false);
  });

  test(`${label} built-in adapter applies the same executable override to discover as the factory receives`, async (t) => {
    const directory = await mkdtemp(join(tmpdir(), "switchyard-adapter-override-"));
    t.after(() => rm(directory, { recursive: true, force: true }));
    const override = await makeScript(
      directory,
      `custom-${command}`,
      `
case "$1" in
  --version) echo "${command} 2.0.0"; exit 0 ;;
  --help) echo "Usage: ${command}"; exit 0 ;;
  *) exit 32 ;;
esac`,
    );

    const adapter = createAdapter({ executable: override, env: { PATH: "" }, now: fixedClock });
    const profile = await adapter.discover();
    assert.equal(profile.executable, override);
    assert.equal(profile.executableSource, "override");
    assert.equal(profile.version, "2.0.0");
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
