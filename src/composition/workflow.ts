import { mkdir, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { ExecutionResult, HarnessAdapter } from "../harness/adapter.ts";
import { assertWorkflow, type ValidatedWorkflow, type WorkflowStage, type StageInput } from "./schema.ts";

export type CompositionStageStatus = "pending" | "running" | "succeeded" | "failed" | "skipped";
export interface CompositionStageResult {
  readonly stageId: string;
  readonly status: CompositionStageStatus;
  readonly selectedHarness: string | null;
  readonly execution: ExecutionResult | null;
  readonly artifacts: readonly { readonly name: string; readonly path?: string; readonly kind: string }[];
  readonly diagnostic?: string;
}
export interface CompositionResult {
  readonly workflowId: string;
  readonly status: "succeeded" | "failed" | "invalid-input";
  readonly stages: readonly CompositionStageResult[];
  readonly statePath: string;
}

export interface CompositionOptions {
  readonly workflow: unknown;
  readonly adapters: Readonly<Record<string, HarnessAdapter>> | Map<string, HarnessAdapter>;
  readonly selectAdapter?: (stage: WorkflowStage) => Promise<HarnessAdapter | undefined> | HarnessAdapter | undefined;
  readonly statePath?: string;
}

function adapterFor(options: CompositionOptions, stage: WorkflowStage): Promise<HarnessAdapter | undefined> {
  if (options.selectAdapter) return Promise.resolve(options.selectAdapter(stage));
  const requirements = stage.requirements;
  const preferred = typeof requirements === "object" && !Array.isArray(requirements)
    ? (requirements as { preferredHarness?: string }).preferredHarness
    : undefined;
  const source = options.adapters;
  const selected = preferred
    ? source instanceof Map ? source.get(preferred) : source[preferred]
    : source instanceof Map ? source.get(stage.id) : source[stage.id];
  return Promise.resolve(selected);
}

function handoff(stage: WorkflowStage, prior: Map<string, CompositionStageResult>): string {
  const entries = (stage.inputs ?? []).map((input: StageInput) => {
    const result = prior.get(input.fromStage);
    const artifact = input.artifact ? result?.artifacts.find((x) => x.name === input.artifact) : undefined;
    return { name: input.name, artifact: artifact ?? null, context: (input.context ?? []).reduce<Record<string, unknown>>((out, key) => {
      const value = key === "status" ? result?.status : key === "selectedHarness" ? result?.selectedHarness : key === "durationMs" ? result?.execution?.durationMs : result?.diagnostic;
      out[key] = value ?? null; return out;
    }, {}) };
  });
  return entries.length ? `${stage.task}\n\nDeclared handoff:\n${JSON.stringify(entries)}` : stage.task;
}

export async function executeWorkflow(options: CompositionOptions): Promise<CompositionResult> {
  let workflow: ValidatedWorkflow;
  try { workflow = assertWorkflow(options.workflow); }
  catch (error) {
    const statePath = options.statePath ?? join(typeof (options.workflow as { workspace?: unknown })?.workspace === "string" ? (options.workflow as { workspace: string }).workspace : process.cwd(), "switchyard-workflow-state.json");
    return { workflowId: "invalid", status: "invalid-input", stages: [], statePath };
  }
  await mkdir(workflow.workspace, { recursive: true });
  const statePath = options.statePath ?? join(workflow.workspace, "switchyard-workflow-state.json");
  const results: CompositionStageResult[] = [];
  const byId = new Map<string, CompositionStageResult>();
  for (const id of workflow.order) {
    const stage = workflow.stages.find((x) => x.id === id)!;
    if ((stage.dependsOn ?? []).some((dep) => byId.get(dep)?.status !== "succeeded")) {
      const skipped: CompositionStageResult = { stageId: id, status: "skipped", selectedHarness: null, execution: null, artifacts: [], diagnostic: "dependency did not succeed" };
      results.push(skipped); byId.set(id, skipped); continue;
    }
    const missingArtifact = await (async () => {
      for (const input of stage.inputs ?? []) {
        if (!input.artifact) continue;
        const source = workflow.stages.find((candidate) => candidate.id === input.fromStage);
        const declaration = source?.outputs?.find((artifact) => artifact.name === input.artifact);
        if (declaration?.path && declaration.kind !== "metadata") {
          try { await stat(join(workflow.workspace, declaration.path)); }
          catch { return `${input.artifact} from ${input.fromStage} is missing`; }
        }
      }
      return undefined;
    })();
    if (missingArtifact) {
      const failed: CompositionStageResult = { stageId: id, status: "failed", selectedHarness: null, execution: null, artifacts: [], diagnostic: missingArtifact };
      results.push(failed); byId.set(id, failed);
      await writeFile(statePath, JSON.stringify({ workflowId: workflow.id, status: "failed", stages: results }, null, 2));
      break;
    }
    const adapter = await adapterFor(options, stage);
    if (!adapter || !adapter.supportedOperations.execute) {
      const failed: CompositionStageResult = { stageId: id, status: "failed", selectedHarness: adapter?.id ?? null, execution: null, artifacts: [], diagnostic: "no eligible adapter supports execute" };
      results.push(failed); byId.set(id, failed); await writeFile(statePath, JSON.stringify({ workflowId: workflow.id, status: "failed", stages: results }, null, 2)); break;
    }
    const running: CompositionStageResult = { stageId: id, status: "running", selectedHarness: adapter.id, execution: null, artifacts: [] };
    results.push(running); byId.set(id, running);
    try {
      const execution = await adapter.execute({ task: handoff(stage, byId), cwd: workflow.workspace, nonInteractive: true });
      const completed: CompositionStageResult = { stageId: id, status: execution.succeeded ? "succeeded" : "failed", selectedHarness: adapter.id, execution, artifacts: execution.succeeded ? (stage.outputs ?? []) : [], ...(execution.error ? { diagnostic: execution.error } : {}) };
      results[results.length - 1] = completed; byId.set(id, completed);
      if (!execution.succeeded) break;
    } catch (error) {
      const failed: CompositionStageResult = { stageId: id, status: "failed", selectedHarness: adapter.id, execution: null, artifacts: [], diagnostic: error instanceof Error ? error.message : "adapter execution failed" };
      results[results.length - 1] = failed; byId.set(id, failed); break;
    }
    await writeFile(statePath, JSON.stringify({ workflowId: workflow.id, status: "running", stages: results }, null, 2));
  }
  const status = results.every((x) => x.status === "succeeded") ? "succeeded" : "failed";
  await writeFile(statePath, JSON.stringify({ workflowId: workflow.id, status, stages: results }, null, 2));
  return { workflowId: workflow.id, status, stages: results, statePath };
}
