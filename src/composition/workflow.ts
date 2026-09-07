import { mkdir, realpath, stat, writeFile } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import type { ExecutionResult, HarnessAdapter } from "../harness/adapter.ts";
import {
  assertWorkflow,
  type ArtifactKind,
  type ValidatedWorkflow,
  type WorkflowArtifact,
  type WorkflowStage,
  type StageInput,
} from "./schema.ts";

export type CompositionStageStatus = "pending" | "running" | "succeeded" | "failed" | "skipped";
export interface CompositionArtifact {
  readonly name: string;
  readonly path?: string;
  readonly kind: ArtifactKind;
  readonly description?: string;
}
export interface CompositionHandoff {
  readonly name: string;
  readonly artifact: CompositionArtifact | null;
  readonly context: Readonly<Record<string, unknown>>;
}
export interface CompositionStageResult {
  readonly stageId: string;
  readonly status: CompositionStageStatus;
  readonly selectedHarness: string | null;
  readonly execution: ExecutionResult | null;
  readonly artifacts: readonly CompositionArtifact[];
  /** The exact declared handoff sent to this stage, retained for inspection. */
  readonly handoff?: readonly CompositionHandoff[];
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

function copyArtifact(artifact: WorkflowArtifact): CompositionArtifact {
  return {
    name: artifact.name,
    ...(artifact.path === undefined ? {} : { path: artifact.path }),
    kind: artifact.kind,
    ...(artifact.description === undefined ? {} : { description: artifact.description }),
  };
}

function handoffEntries(stage: WorkflowStage, prior: Map<string, CompositionStageResult>): CompositionHandoff[] {
  return (stage.inputs ?? []).map((input: StageInput) => {
    const result = prior.get(input.fromStage);
    const artifact = input.artifact ? result?.artifacts.find((x) => x.name === input.artifact) : undefined;
    return { name: input.name, artifact: artifact ? { ...artifact } : null, context: (input.context ?? []).reduce<Record<string, unknown>>((out, key) => {
      const value = key === "status" ? result?.status : key === "selectedHarness" ? result?.selectedHarness : key === "durationMs" ? result?.execution?.durationMs : result?.diagnostic;
      out[key] = value ?? null; return out;
    }, {}) };
  });
}

function handoffTask(stage: WorkflowStage, prior: Map<string, CompositionStageResult>): { task: string; entries: CompositionHandoff[] } {
  const entries = handoffEntries(stage, prior);
  return {
    task: entries.length ? `${stage.task}\n\nDeclared handoff:\n${JSON.stringify(entries)}` : stage.task,
    entries,
  };
}

function pathInside(workspace: string, candidate: string): boolean {
  const root = resolve(workspace);
  const target = resolve(root, candidate);
  const rel = relative(root, target);
  return rel === "" || (rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
}

async function artifactAvailability(
  workspace: string,
  declaration: WorkflowArtifact,
): Promise<string | undefined> {
  if (declaration.kind === "metadata" || declaration.path === undefined) return undefined;
  if (!pathInside(workspace, declaration.path)) {
    return `${declaration.name} points outside the workflow workspace`;
  }
  const target = resolve(workspace, declaration.path);
  try {
    const workspaceRealPath = await realpath(workspace);
    const targetRealPath = await realpath(target);
    const relativeTarget = relative(workspaceRealPath, targetRealPath);
    if (relativeTarget !== "" && (relativeTarget === ".." || relativeTarget.startsWith(`..${sep}`) || isAbsolute(relativeTarget))) {
      return `${declaration.name} points outside the workflow workspace`;
    }
    const information = await stat(target);
    if (declaration.kind === "file" && !information.isFile()) return `${declaration.name} is not a file`;
    if (declaration.kind === "directory" && !information.isDirectory()) return `${declaration.name} is not a directory`;
  } catch {
    // A missing artifact is reported at the receiving stage. This preserves
    // the successful producer result for inspection and durable replay.
    return `${declaration.name} is missing`;
  }
  return undefined;
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
  const persist = async (status: "running" | "failed" | "succeeded") => {
    await writeFile(statePath, JSON.stringify({ workflowId: workflow.id, status, stages: results }, null, 2));
  };
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
        if (!declaration) return `${input.artifact} from ${input.fromStage} is not available`;
        const diagnostic = await artifactAvailability(workflow.workspace, declaration);
        if (diagnostic) return `${input.artifact} from ${input.fromStage} ${diagnostic}`;
      }
      return undefined;
    })();
    if (missingArtifact) {
      const failed: CompositionStageResult = { stageId: id, status: "failed", selectedHarness: null, execution: null, artifacts: [], diagnostic: missingArtifact };
      results.push(failed); byId.set(id, failed);
      await persist("running");
      continue;
    }
    const adapter = await adapterFor(options, stage);
    if (!adapter || !adapter.supportedOperations.execute) {
      const failed: CompositionStageResult = { stageId: id, status: "failed", selectedHarness: adapter?.id ?? null, execution: null, artifacts: [], diagnostic: "no eligible adapter supports execute" };
      results.push(failed); byId.set(id, failed); await persist("running"); continue;
    }
    const handoff = handoffTask(stage, byId);
    const running: CompositionStageResult = {
      stageId: id,
      status: "running",
      selectedHarness: adapter.id,
      execution: null,
      artifacts: [],
      ...(handoff.entries.length ? { handoff: handoff.entries } : {}),
    };
    results.push(running); byId.set(id, running);
    await persist("running");
    try {
      const execution = await adapter.execute({ task: handoff.task, cwd: workflow.workspace, nonInteractive: true });
      const completed: CompositionStageResult = {
        stageId: id,
        status: execution.succeeded ? "succeeded" : "failed",
        selectedHarness: adapter.id,
        execution,
        artifacts: execution.succeeded ? (stage.outputs ?? []).map(copyArtifact) : [],
        ...(handoff.entries.length ? { handoff: handoff.entries } : {}),
        ...(execution.error ? { diagnostic: execution.error } : {}),
      };
      results[results.length - 1] = completed; byId.set(id, completed);
    } catch (error) {
      const failed: CompositionStageResult = { stageId: id, status: "failed", selectedHarness: adapter.id, execution: null, artifacts: [], diagnostic: error instanceof Error ? error.message : "adapter execution failed" };
      results[results.length - 1] = failed; byId.set(id, failed);
    }
    await persist("running");
  }
  const status = results.every((x) => x.status === "succeeded") ? "succeeded" : "failed";
  await persist(status);
  return { workflowId: workflow.id, status, stages: results, statePath };
}
