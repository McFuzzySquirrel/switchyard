import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  validateWorkflow,
  executeWorkflow,
} from "../src/composition/index.ts";

const operations = { discover: true, verify: true, execute: true, resume: false, fork: false };
const result = (succeeded, stdout = "") => ({
  succeeded, status: succeeded ? "succeeded" : "failed",
  failureCategory: succeeded ? "none" : "execution-failure", exitCode: succeeded ? 0 : 1,
  stdout, stderr: "", stdoutTruncated: false, stderrTruncated: false, durationMs: 1,
});

test("rejects cycles and unsatisfied declared artifact handoff before execution", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "switchyard-compose-"));
  const cycle = validateWorkflow({
    id: "cycle", workspace,
    stages: [
      { id: "a", dependsOn: ["b"], requirements: [], task: "a" },
      { id: "b", dependsOn: ["a"], requirements: [], task: "b" },
    ],
  });
  assert.equal(cycle.success, false);
  assert.match(cycle.issues.map((x) => x.message).join(" "), /cycle/);

  const missing = validateWorkflow({
    id: "missing", workspace,
    stages: [
      { id: "impl", requirements: [], task: "impl", outputs: [{ name: "patch", kind: "file" }] },
      { id: "review", dependsOn: ["impl"], requirements: [], task: "review",
        inputs: [{ name: "wrong", fromStage: "impl", artifact: "not-declared" }] },
    ],
  });
  assert.equal(missing.success, false);
  assert.match(missing.issues.map((x) => x.message).join(" "), /not declared/);
});

test("returns a stable topological order and rejects invalid dependency declarations", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "switchyard-compose-"));
  const validation = validateWorkflow({
    id: "ordered", workspace,
    stages: [
      { id: "review", dependsOn: ["package"], requirements: [], task: "review" },
      { id: "package", dependsOn: ["implementation"], requirements: [], task: "package" },
      { id: "implementation", requirements: [], task: "implement" },
    ],
  });
  assert.equal(validation.success, true);
  assert.deepEqual(validation.value.order, ["implementation", "package", "review"]);

  const invalid = validateWorkflow({
    id: "invalid-dependencies", workspace,
    stages: [
      { id: "implementation", dependsOn: ["implementation", "missing"], requirements: [], task: "implement" },
    ],
  });
  assert.equal(invalid.success, false);
  const messages = invalid.issues.map((x) => x.message).join(" ");
  assert.match(messages, /unknown stage 'missing'/);
  assert.match(messages, /cycle/);
});

test("executes stages in dependency order even when declarations are reversed", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "switchyard-compose-"));
  const tasks = [];
  const makeAdapter = (id) => ({
    id, supportedOperations: operations,
    async execute(request) { tasks.push(request.task); return result(true); },
  });
  const workflow = {
    id: "reverse-order", workspace,
    stages: [
      { id: "review", dependsOn: ["implementation"], requirements: [], task: "review" },
      { id: "implementation", requirements: [], task: "implement" },
    ],
  };
  const outcome = await executeWorkflow({
    workflow,
    adapters: { implementation: makeAdapter("implementation"), review: makeAdapter("review") },
  });
  assert.equal(outcome.status, "succeeded");
  assert.deepEqual(tasks, ["implement", "review"]);
  assert.deepEqual(outcome.stages.map((stage) => stage.stageId), ["implementation", "review"]);
});

test("executes sequential stages with only declared handoff and preserves prior result on failure", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "switchyard-compose-"));
  const tasks = [];
  let reviewCanSeeUndeclared = true;
  const implementation = {
    id: "opencode", supportedOperations: operations,
    async execute(request) {
      tasks.push(request.task);
      if (request.task === "implement") {
        const fs = await import("node:fs/promises");
        await fs.writeFile(join(request.cwd, "patch.diff"), "diff");
        await fs.writeFile(join(request.cwd, "undeclared-secret.txt"), "must not cross stage boundary");
      }
      return result(true, "implementation");
    },
  };
  const review = {
    id: "copilot", supportedOperations: operations,
    async execute(request) {
      tasks.push(request.task);
      reviewCanSeeUndeclared = await (await import("node:fs/promises"))
        .access(join(request.cwd, "undeclared-secret.txt"))
        .then(() => true, () => false);
      assert.deepEqual(request.environmentPolicy, { inherit: false });
      return result(false);
    },
  };
  const workflow = {
    id: "demo", workspace,
    stages: [
      { id: "implementation", requirements: [], task: "implement", outputs: [{ name: "patch", kind: "file", path: "patch.diff" }] },
      { id: "review", dependsOn: ["implementation"], requirements: [], task: "review",
        inputs: [{ name: "patch-input", fromStage: "implementation", artifact: "patch", context: ["status"] }] },
    ],
  };
  const outcome = await executeWorkflow({ workflow, adapters: { implementation, review } });
  assert.equal(outcome.status, "failed");
  assert.deepEqual(outcome.stages.map((x) => x.status), ["succeeded", "failed"]);
  assert.match(tasks[1], /patch-input/);
  assert.match(tasks[1], /"status":"succeeded"/);
  assert.equal(reviewCanSeeUndeclared, false);
  const state = JSON.parse(await readFile(outcome.statePath, "utf8"));
  assert.equal(state.schemaVersion, 1);
  assert.deepEqual(state.stages.map((x) => x.status), ["succeeded", "failed"]);
});

test("rejects artifact paths outside the workflow workspace", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "switchyard-compose-"));
  const validation = validateWorkflow({
    id: "escape", workspace,
    stages: [{ id: "a", requirements: [], task: "a", outputs: [{ name: "secret", kind: "file", path: "../secret" }] }],
  });
  assert.equal(validation.success, false);
  assert.match(validation.issues.map((x) => x.message).join(" "), /inside/);

  const rootArtifact = validateWorkflow({
    id: "root-artifact", workspace,
    stages: [{ id: "a", requirements: [], task: "a", outputs: [{ name: "everything", kind: "directory", path: "." }] }],
  });
  assert.equal(rootArtifact.success, false);
});

test("rejects produced artifacts whose symlink resolves outside the workflow workspace", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "switchyard-compose-"));
  const outside = await mkdtemp(join(tmpdir(), "switchyard-compose-outside-"));
  const implementation = {
    id: "implementation", supportedOperations: operations,
    async execute(request) {
      await writeFile(join(outside, "secret.txt"), "must not cross the boundary");
      await symlink(join(outside, "secret.txt"), join(request.cwd, "patch.diff"));
      return result(true);
    },
  };
  const review = {
    id: "review", supportedOperations: operations,
    async execute() { throw new Error("must not run after unsafe output"); },
  };
  const outcome = await executeWorkflow({
    workflow: {
      id: "symlink-escape",
      workspace,
      stages: [
        {
          id: "implementation",
          requirements: [],
          task: "implement",
          outputs: [{ name: "patch", kind: "file", path: "patch.diff" }],
        },
        {
          id: "review",
          dependsOn: ["implementation"],
          requirements: [],
          task: "review",
          inputs: [{ name: "patch-input", fromStage: "implementation", artifact: "patch" }],
        },
      ],
    },
    adapters: { implementation, review },
  });
  assert.equal(outcome.status, "failed");
  assert.deepEqual(outcome.stages.map((stage) => stage.status), ["failed", "skipped"]);
  assert.match(outcome.stages[0].diagnostic, /outside the workflow workspace/);
});

test("rejects opaque schema fields and unusable artifact declarations", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "switchyard-compose-"));
  const validation = validateWorkflow({
    id: "strict-schema",
    workspace,
    unexpected: "must not cross the workflow boundary",
    stages: [{
      id: "a",
      requirements: [],
      task: "a",
      extra: true,
    }],
  });
  assert.equal(validation.success, false);
  assert.match(validation.issues.map((x) => x.message).join(" "), /recognized field/);

  const artifacts = validateWorkflow({
    id: "strict-artifacts",
    workspace,
    stages: [{
      id: "a",
      requirements: [],
      task: "a",
      outputs: [
        { name: "metadata-with-path", kind: "metadata", path: "metadata.json" },
        { name: "file-without-path", kind: "file" },
      ],
    }],
  });
  assert.equal(artifacts.success, false);
  const artifactMessages = artifacts.issues.map((x) => x.message).join(" ");
  assert.match(artifactMessages, /must not declare a path/);
  assert.match(artifactMessages, /workspace-contained relative path/);
});

test("requires unique declared inputs and rejects undeclared or duplicate context", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "switchyard-compose-"));
  const validation = validateWorkflow({
    id: "invalid-handoff",
    workspace,
    stages: [
      { id: "impl", requirements: [], task: "implement",
        outputs: [{ name: "patch", kind: "file", path: "patch.diff" }] },
      { id: "review", dependsOn: ["impl"], requirements: [], task: "review",
        inputs: [
          { name: "patch", fromStage: "impl", artifact: "patch", context: ["status", "status"] },
          { name: "patch", fromStage: "impl", artifact: "missing" },
        ] },
    ],
  });
  assert.equal(validation.success, false);
  const messages = validation.issues.map((x) => x.message).join(" ");
  assert.match(messages, /unique valid identifiers/);
  assert.match(messages, /undeclared or duplicate context/);
  assert.match(messages, /not declared/);
});

test("records a sanitized handoff manifest and rejects missing or mismatched artifacts", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "switchyard-compose-"));
  const tasks = [];
  const implementation = {
    id: "implementation", supportedOperations: operations,
    async execute(request) {
      tasks.push(request.task);
      if (request.task === "implement") {
        await (await import("node:fs/promises")).writeFile(join(request.cwd, "notes.txt"), "notes");
      }
      return result(true, "implementation");
    },
  };
  const review = {
    id: "review", supportedOperations: operations,
    async execute(request) { tasks.push(request.task); return result(true, "review"); },
  };
  const workflow = {
    id: "handoff-manifest", workspace,
    stages: [
      { id: "implementation", requirements: [], task: "implement",
        outputs: [
          { name: "notes", kind: "file", path: "notes.txt", description: "declared notes" },
          { name: "summary", kind: "metadata", description: "declared summary" },
        ] },
      { id: "review", dependsOn: ["implementation"], requirements: [], task: "review",
        inputs: [
          { name: "notes-input", fromStage: "implementation", artifact: "notes",
            context: ["status", "selectedHarness", "durationMs"] },
          { name: "summary-input", fromStage: "implementation", artifact: "summary",
            context: ["diagnostic"] },
        ] },
    ],
  };

  const outcome = await executeWorkflow({ workflow, adapters: { implementation, review } });
  assert.equal(outcome.status, "succeeded");
  assert.deepEqual(outcome.stages[0].artifacts, [
    { name: "notes", kind: "file", path: "notes.txt", description: "declared notes" },
    { name: "summary", kind: "metadata", description: "declared summary" },
  ]);
  assert.deepEqual(outcome.stages[1].handoff, [
    {
      name: "notes-input",
      artifact: { name: "notes", kind: "file", path: "notes.txt", description: "declared notes" },
      context: { status: "succeeded", selectedHarness: "implementation", durationMs: 1 },
    },
    {
      name: "summary-input",
      artifact: { name: "summary", kind: "metadata", description: "declared summary" },
      context: { diagnostic: null },
    },
  ]);
  assert.match(tasks[1], /Declared handoff/);
  assert.doesNotMatch(tasks[1], /"stdout"/);
  assert.doesNotMatch(tasks[1], /"stderr"/);

  const missingWorkflow = {
    ...workflow,
    id: "missing-handoff",
    stages: workflow.stages.map((stage) => stage.id === "review"
      ? { ...stage, inputs: [{ name: "notes-input", fromStage: "implementation", artifact: "notes" }] }
      : stage.id === "implementation" ? { ...stage, task: "implement-without-file" }
      : stage),
  };
  await (await import("node:fs/promises")).unlink(join(workspace, "notes.txt"));
  const missing = await executeWorkflow({ workflow: missingWorkflow, adapters: { implementation, review } });
  assert.equal(missing.status, "failed");
  assert.deepEqual(missing.stages.map((stage) => stage.status), ["failed", "skipped"]);
  assert.match(missing.stages[0].diagnostic, /declared output notes .*missing/);

  const wrongKindWorkflow = {
    ...workflow,
    id: "wrong-kind-handoff",
    stages: workflow.stages.map((stage) => stage.id === "implementation"
      ? { ...stage, outputs: stage.outputs.map((artifact) => artifact.name === "notes" ? { ...artifact, kind: "directory" } : artifact) }
      : stage),
  };
  const wrongKind = await executeWorkflow({ workflow: wrongKindWorkflow, adapters: { implementation, review } });
  assert.equal(wrongKind.status, "failed");
  assert.deepEqual(wrongKind.stages.map((stage) => stage.status), ["failed", "skipped"]);
  assert.match(wrongKind.stages[0].diagnostic, /declared output notes .*not a directory/);
});

test("preserves completed stages when selection or execution fails and skips dependents", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "switchyard-compose-"));
  const calls = [];
  const implementation = {
    id: "implementation", supportedOperations: operations,
    async execute() {
      calls.push("implementation");
      return result(true);
    },
  };
  const review = {
    id: "review", supportedOperations: operations,
    async execute() {
      calls.push("review");
      throw new Error("review adapter failed");
    },
  };
  const followup = {
    id: "followup", supportedOperations: operations,
    async execute() {
      calls.push("followup");
      return result(true);
    },
  };

  const outcome = await executeWorkflow({
    workflow: {
      id: "partial-selection",
      workspace,
      stages: [
        { id: "implementation", requirements: [], task: "implement" },
        { id: "review", dependsOn: ["implementation"], requirements: [], task: "review" },
        { id: "followup", dependsOn: ["review"], requirements: [], task: "follow up" },
      ],
    },
    selectAdapter: (stage) => stage.id === "implementation"
      ? implementation
      : stage.id === "review"
        ? review
        : followup,
    adapters: {},
  });

  assert.equal(outcome.status, "failed");
  assert.deepEqual(calls, ["implementation", "review"]);
  assert.deepEqual(outcome.stages.map((stage) => stage.status), ["succeeded", "failed", "skipped"]);
  const state = JSON.parse(await readFile(outcome.statePath, "utf8"));
  assert.equal(state.schemaVersion, 1);
  assert.deepEqual(state.stages.map((stage) => stage.status), ["succeeded", "failed", "skipped"]);
  assert.match(outcome.stages[1].diagnostic, /review adapter failed/);
});
