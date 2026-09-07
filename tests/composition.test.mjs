import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
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

test("executes sequential stages with only declared handoff and preserves prior result on failure", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "switchyard-compose-"));
  const tasks = [];
  const implementation = {
    id: "opencode", supportedOperations: operations,
    async execute(request) { tasks.push(request.task); if (request.task === "implement") await (await import("node:fs/promises")).writeFile(join(workspace, "patch.diff"), "diff"); return result(true, "implementation"); },
  };
  const review = {
    id: "copilot", supportedOperations: operations,
    async execute(request) { tasks.push(request.task); return result(false); },
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
  const state = JSON.parse(await readFile(outcome.statePath, "utf8"));
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
});
