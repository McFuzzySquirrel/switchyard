import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  compose,
  discover,
  findExecutable,
  createOpenCodeAdapter,
  createGitHubCopilotAdapter,
} from "../src/index.ts";

const observedAt = "2026-09-07T19:00:00.000Z";
const operations = { discover: true, verify: true, execute: true, resume: false, fork: false };
const exampleWorkflowPath = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "examples",
  "opencode-to-copilot.workflow.json",
);

function observation(capability) {
  return {
    schemaVersion: 1,
    capability,
    discovery: {
      status: "observed",
      source: "help",
      observedAt,
      evidence: { source: "help", excerpt: "usage", capturedAt: observedAt, reference: "--help" },
    },
    verification: { status: "not-requested" },
  };
}

/**
 * Builds a fixture stand-in for a harness that has not (yet) implemented
 * `execute`. It is registered under the real harness's own ID, so routing
 * (`explain`) cannot distinguish it from a genuine adapter: only the
 * execution registry differs between the "installed" and "fixture" paths.
 */
function fixtureImplementationAdapter(id) {
  return {
    id,
    supportedOperations: operations,
    async execute(request) {
      await (await import("node:fs/promises")).writeFile(
        join(request.cwd, "patch.diff"),
        "--- a/example.txt\n+++ b/example.txt\n+demonstration change\n",
      );
      return {
        succeeded: true,
        status: "succeeded",
        failureCategory: "none",
        exitCode: 0,
        stdout: `${id} implemented the requested change and wrote patch.diff`,
        stderr: "",
        stdoutTruncated: false,
        stderrTruncated: false,
        durationMs: 1,
      };
    },
  };
}

function fixtureReviewAdapter(id) {
  return {
    id,
    supportedOperations: operations,
    async execute(request) {
      return {
        succeeded: true,
        status: "succeeded",
        failureCategory: "none",
        exitCode: 0,
        stdout: `${id} reviewed the declared handoff: ${request.task.includes("Declared handoff") ? "received patch and status" : "no handoff present"}`,
        stderr: "",
        stdoutTruncated: false,
        stderrTruncated: false,
        durationMs: 1,
      };
    },
  };
}

/**
 * Resolves the execution-capable adapter for one participant: the real
 * built-in adapter when the vendor executable is installed on PATH *and*
 * that adapter already implements `execute`, and a fixture stand-in
 * registered under the same ID otherwise. This is what keeps the
 * demonstration reproducible in any environment while remaining accurate
 * about what actually ran a process.
 */
async function resolveParticipant(command, realAdapter, fixtureAdapter) {
  const found = await findExecutable(command);
  if (found !== undefined && realAdapter.supportedOperations.execute) {
    return { adapter: realAdapter, real: true };
  }
  return { adapter: fixtureAdapter, real: false };
}

test("reproducible OpenCode-to-Copilot implementation/review workflow completes end to end", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "switchyard-composition-demo-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const registryPath = join(directory, "registry.json");
  const workspace = join(directory, "workspace");

  // The registry drives real deterministic routing (`explain`) regardless of
  // which execution path is selected below; it advertises the same
  // capabilities the real adapters' discovery would observe.
  await discover({
    registryPath,
    adapters: [
      {
        id: "opencode",
        discover: async () => ({
          schemaVersion: 1,
          id: "opencode",
          displayName: "OpenCode",
          executable: "/fixtures/opencode",
          executableSource: "path",
          capabilities: [observation("headless")],
          status: "available",
          lifecycle: "registered",
          availability: { status: "available", checkedAt: observedAt },
          discoveredAt: observedAt,
          updatedAt: observedAt,
        }),
      },
      {
        id: "copilot",
        discover: async () => ({
          schemaVersion: 1,
          id: "copilot",
          displayName: "GitHub Copilot",
          executable: "/fixtures/copilot",
          executableSource: "path",
          capabilities: [observation("github-context")],
          status: "available",
          lifecycle: "registered",
          availability: { status: "available", checkedAt: observedAt },
          discoveredAt: observedAt,
          updatedAt: observedAt,
        }),
      },
    ],
    now: () => new Date(observedAt),
  });

  const opencode = await resolveParticipant(
    "opencode",
    createOpenCodeAdapter(),
    fixtureImplementationAdapter("opencode"),
  );
  const copilot = await resolveParticipant(
    "copilot",
    createGitHubCopilotAdapter(),
    fixtureReviewAdapter("copilot"),
  );
  t.diagnostic(
    `opencode: ${opencode.real ? "real installed adapter" : "fixture adapter"}; ` +
      `copilot: ${copilot.real ? "real installed adapter" : "fixture adapter"}`,
  );

  const workflow = {
    ...JSON.parse(await readFile(exampleWorkflowPath, "utf8")),
    workspace,
  };

  const result = await compose({
    workflow,
    registryPath,
    adapters: [opencode.adapter, copilot.adapter],
  });

  assert.equal(result.status, "success");
  assert.deepEqual(result.stages.map((stage) => stage.stageId), ["implementation", "review"]);
  assert.deepEqual(result.stages.map((stage) => stage.status), ["succeeded", "succeeded"]);
  assert.deepEqual(result.stages.map((stage) => stage.selectedHarness), ["opencode", "copilot"]);
  assert.deepEqual(result.stages[0].artifacts, [
    { name: "patch", kind: "file", path: "patch.diff", description: "Implementation diff" },
  ]);
  assert.deepEqual(result.stages[1].handoff, [
    {
      name: "patch-input",
      artifact: { name: "patch", kind: "file", path: "patch.diff", description: "Implementation diff" },
      context: { status: "succeeded", selectedHarness: "opencode" },
    },
  ]);

  const patch = await readFile(join(workspace, "patch.diff"), "utf8");
  assert.match(patch, /demonstration change/);

  const persisted = JSON.parse(await readFile(result.statePath, "utf8"));
  assert.equal(persisted.status, "succeeded");
  assert.deepEqual(persisted.stages.map((stage) => stage.status), ["succeeded", "succeeded"]);
});

test("the demonstration preserves the implementation result when review fails", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "switchyard-composition-demo-failure-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const registryPath = join(directory, "registry.json");
  const workspace = join(directory, "workspace");

  await discover({
    registryPath,
    adapters: [
      {
        id: "opencode",
        discover: async () => ({
          schemaVersion: 1,
          id: "opencode",
          displayName: "OpenCode",
          executable: "/fixtures/opencode",
          executableSource: "path",
          capabilities: [observation("headless")],
          status: "available",
          lifecycle: "registered",
          availability: { status: "available", checkedAt: observedAt },
          discoveredAt: observedAt,
          updatedAt: observedAt,
        }),
      },
      {
        id: "copilot",
        discover: async () => ({
          schemaVersion: 1,
          id: "copilot",
          displayName: "GitHub Copilot",
          executable: "/fixtures/copilot",
          executableSource: "path",
          capabilities: [observation("github-context")],
          status: "available",
          lifecycle: "registered",
          availability: { status: "available", checkedAt: observedAt },
          discoveredAt: observedAt,
          updatedAt: observedAt,
        }),
      },
    ],
    now: () => new Date(observedAt),
  });

  const failingReview = {
    id: "copilot",
    supportedOperations: operations,
    async execute() {
      return {
        succeeded: false,
        status: "failed",
        failureCategory: "execution-failure",
        exitCode: 1,
        stdout: "",
        stderr: "requested change conflicts with policy",
        stdoutTruncated: false,
        stderrTruncated: false,
        durationMs: 1,
        error: "requested change conflicts with policy",
      };
    },
  };

  const workflow = {
    id: "opencode-copilot-demo-failure",
    workspace,
    stages: [
      {
        id: "implementation",
        requirements: { schemaVersion: 1, requires: ["headless"], preferredHarness: "opencode" },
        task: "Implement the requested change and publish it as a reviewable patch.",
        outputs: [{ name: "patch", kind: "file", path: "patch.diff" }],
      },
      {
        id: "review",
        dependsOn: ["implementation"],
        requirements: { schemaVersion: 1, requires: ["github-context"], preferredHarness: "copilot" },
        task: "Review the implementation patch for correctness before merge.",
        inputs: [{ name: "patch-input", fromStage: "implementation", artifact: "patch", context: ["status"] }],
      },
    ],
  };

  const result = await compose({
    workflow,
    registryPath,
    adapters: [fixtureImplementationAdapter("opencode"), failingReview],
  });

  assert.equal(result.status, "partial");
  assert.deepEqual(result.stages.map((stage) => stage.status), ["succeeded", "failed"]);
  assert.equal(result.stages[0].status, "succeeded");
  assert.deepEqual(result.stages[0].artifacts, [{ name: "patch", kind: "file", path: "patch.diff" }]);
  assert.match(result.stages[1].diagnostic, /conflicts with policy/);

  const persisted = JSON.parse(await readFile(result.statePath, "utf8"));
  assert.deepEqual(persisted.stages.map((stage) => stage.status), ["succeeded", "failed"]);
  assert.deepEqual(persisted.stages[0].artifacts, [{ name: "patch", kind: "file", path: "patch.diff" }]);
});
