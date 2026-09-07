import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  compose,
  composeInvalidInput,
  formatComposeHuman,
  formatComposeJson,
  ComposeInputError,
  discover,
  runCli,
  CLI_EXIT_CODES,
} from "../src/index.ts";

const observedAt = "2026-09-07T19:00:00.000Z";

function profile(id, capability) {
  return {
    schemaVersion: 1,
    id,
    displayName: id,
    executable: `/tmp/${id}`,
    executableSource: "path",
    version: "1.0.0",
    capabilities: [
      {
        schemaVersion: 1,
        capability,
        discovery: {
          status: "observed",
          source: "help",
          observedAt,
          evidence: { source: "help", excerpt: "usage", capturedAt: observedAt, reference: "--help" },
        },
        verification: { status: "not-requested" },
      },
    ],
    status: "available",
    lifecycle: "registered",
    availability: { status: "available", checkedAt: observedAt },
    discoveredAt: observedAt,
    updatedAt: observedAt,
  };
}

const operations = { discover: true, verify: true, execute: true, resume: false, fork: false };
const executionResult = (succeeded, stdout = "") => ({
  succeeded,
  status: succeeded ? "succeeded" : "failed",
  failureCategory: succeeded ? "none" : "execution-failure",
  exitCode: succeeded ? 0 : 1,
  stdout,
  stderr: "",
  stdoutTruncated: false,
  stderrTruncated: false,
  durationMs: 1,
});

async function seedRegistry(registryPath) {
  await discover({
    registryPath,
    adapters: [
      { id: "implementer", discover: async () => profile("implementer", "headless") },
      { id: "reviewer", discover: async () => profile("reviewer", "github-context") },
    ],
    now: () => new Date(observedAt),
  });
}

test("compose rejects an invalid workflow graph before selecting any adapter", async () => {
  await assert.rejects(
    () => compose({
      workflow: {
        id: "cycle",
        workspace: "/tmp/does-not-matter",
        stages: [
          { id: "a", dependsOn: ["b"], requirements: [], task: "a" },
          { id: "b", dependsOn: ["a"], requirements: [], task: "b" },
        ],
      },
    }),
    (error) => {
      assert.ok(error instanceof ComposeInputError);
      assert.match(error.issues.map((issue) => issue.message).join(" "), /cycle/);
      return true;
    },
  );
});

test("compose requires a workflow or workflowPath", async () => {
  await assert.rejects(
    () => compose({}),
    (error) => {
      assert.ok(error instanceof ComposeInputError);
      assert.match(error.issues[0].message, /workflow or workflowPath/);
      return true;
    },
  );
});

test("compose reads a workflow file and reports invalid JSON as invalid-input", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "switchyard-compose-file-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const workflowPath = join(directory, "workflow.json");
  await writeFile(workflowPath, "{ not json");

  await assert.rejects(
    () => compose({ workflowPath }),
    (error) => {
      assert.ok(error instanceof ComposeInputError);
      assert.match(error.issues[0].message, /valid JSON/);
      return true;
    },
  );

  const invalid = composeInvalidInput(new ComposeInputError([{ path: "$", message: "bad" }]));
  assert.equal(invalid.status, "invalid-input");
  assert.match(formatComposeHuman(invalid), /invalid-input/);
  assert.match(formatComposeJson(invalid), /"invalid-input"/);
});

test("compose routes each stage through the same deterministic policy as explain/run and preserves prior results on later failure", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "switchyard-compose-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const registryPath = join(directory, "registry.json");
  await seedRegistry(registryPath);
  const workspace = join(directory, "workspace");

  const tasks = [];
  const implementer = {
    id: "implementer",
    supportedOperations: operations,
    async execute(request) {
      tasks.push(request.task);
      await writeFile(join(request.cwd, "patch.diff"), "diff");
      return executionResult(true, "implementation");
    },
  };
  const reviewer = {
    id: "reviewer",
    supportedOperations: operations,
    async execute(request) {
      tasks.push(request.task);
      return executionResult(false, "review");
    },
  };

  const workflow = {
    id: "opencode-copilot-demo",
    workspace,
    stages: [
      {
        id: "implementation",
        requirements: ["headless"],
        task: "implement the requested change",
        outputs: [{ name: "patch", kind: "file", path: "patch.diff" }],
      },
      {
        id: "review",
        dependsOn: ["implementation"],
        requirements: ["github-context"],
        task: "review the change",
        inputs: [
          { name: "patch-input", fromStage: "implementation", artifact: "patch", context: ["status"] },
        ],
      },
    ],
  };

  const result = await compose({
    workflow,
    registryPath,
    adapters: [implementer, reviewer],
    now: () => new Date(observedAt),
  });

  assert.equal(result.command, "compose");
  assert.equal(result.status, "partial");
  assert.deepEqual(result.stages.map((stage) => stage.status), ["succeeded", "failed"]);
  assert.deepEqual(result.stages.map((stage) => stage.selectedHarness), ["implementer", "reviewer"]);
  assert.match(tasks[1], /patch-input/);
  const persisted = JSON.parse(await readFile(result.statePath, "utf8"));
  assert.deepEqual(persisted.stages.map((stage) => stage.status), ["succeeded", "failed"]);
  assert.match(formatComposeHuman(result), /implementation: succeeded/);
  assert.match(formatComposeHuman(result), /review: failed/);
});

test("compose fails a stage with no eligible adapter without selecting an unrelated one", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "switchyard-compose-nomatch-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const registryPath = join(directory, "registry.json");
  await seedRegistry(registryPath);
  const workspace = join(directory, "workspace");

  const workflow = {
    id: "no-match",
    workspace,
    stages: [
      { id: "implementation", requirements: ["mcp"], task: "implement" },
    ],
  };

  const result = await compose({ workflow, registryPath, adapters: [] });
  assert.equal(result.status, "partial");
  assert.equal(result.stages[0].status, "failed");
  assert.match(result.stages[0].diagnostic, /no eligible adapter/);
});

test("CLI compose command validates, executes, and reports stable exit categories", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "switchyard-compose-cli-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const registryPath = join(directory, "registry.json");
  await seedRegistry(registryPath);
  const workspace = join(directory, "workspace");
  const workflowPath = join(directory, "workflow.json");
  await writeFile(workflowPath, JSON.stringify({
    id: "cli-demo",
    workspace,
    stages: [
      { id: "implementation", requirements: ["headless"], task: "implement" },
      {
        id: "review",
        dependsOn: ["implementation"],
        requirements: ["github-context"],
        task: "review",
        inputs: [{ name: "status-only", fromStage: "implementation", context: ["status"] }],
      },
    ],
  }));

  const implementer = {
    id: "implementer",
    supportedOperations: operations,
    async execute() { return executionResult(true, "impl-output token=leaked-value"); },
  };
  const reviewer = {
    id: "reviewer",
    supportedOperations: operations,
    async execute() { return executionResult(true, "review-output"); },
  };

  const stdout = [];
  const exitCode = await runCli(
    ["compose", workflowPath, "--registry", registryPath, "--json"],
    { stdout: (text) => stdout.push(text), stderr: () => {} },
    undefined,
    [implementer, reviewer],
  );

  assert.equal(exitCode, CLI_EXIT_CODES.success);
  const payload = JSON.parse(stdout.join(""));
  assert.equal(payload.command, "compose");
  assert.equal(payload.status, "success");
  assert.deepEqual(payload.stages.map((stage) => stage.status), ["succeeded", "succeeded"]);
  assert.doesNotMatch(JSON.stringify(payload), /leaked-value/);
  assert.match(JSON.stringify(payload), /\[REDACTED\]/);

  const missingStderr = [];
  const missingExit = await runCli(
    ["compose", join(directory, "missing.json"), "--json"],
    { stdout: () => {}, stderr: (text) => missingStderr.push(text) },
  );
  assert.equal(missingExit, CLI_EXIT_CODES.invalidInput);

  const usageStderr = [];
  const usageExit = await runCli(
    ["compose"],
    { stderr: (text) => usageStderr.push(text) },
  );
  assert.equal(usageExit, CLI_EXIT_CODES.invalidInput);
  assert.match(usageStderr.join(""), /workflow or workflowPath/);
});
