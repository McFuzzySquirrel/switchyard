import {
  chmod,
  cp,
  mkdir,
  mkdtemp,
  realpath,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { tmpdir } from "node:os";
import type { ExecutionResult, HarnessAdapter } from "../harness/adapter.ts";
import { redactSecrets } from "../discovery/probe.ts";
import {
  assertWorkflow,
  type ArtifactKind,
  type ValidatedWorkflow,
  type WorkflowArtifact,
  type WorkflowStage,
  type StageInput,
} from "./schema.ts";

export type CompositionStageStatus = "pending" | "running" | "succeeded" | "failed" | "skipped";
export const COMPOSITION_STATE_SCHEMA_VERSION = 1 as const;
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

export interface CompositionState {
  readonly schemaVersion: typeof COMPOSITION_STATE_SCHEMA_VERSION;
  readonly workflowId: string;
  readonly status: "running" | "failed" | "succeeded";
  readonly stages: readonly CompositionStageResult[];
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
    return {
      name: input.name,
      artifact: artifact ? { ...artifact } : null,
      context: (input.context ?? []).reduce<Record<string, unknown>>((out, key) => {
        const value = key === "status"
          ? result?.status
          : key === "selectedHarness"
            ? result?.selectedHarness
            : key === "durationMs"
              ? result?.execution?.durationMs
              : result?.diagnostic;
        // Diagnostics are an explicitly allowed context field, but they are
        // still adapter output and must be sanitized before crossing a stage
        // boundary.
        out[key] = typeof value === "string" ? redactSecrets(value) : value ?? null;
        return out;
      }, {}),
    };
  });
}

function handoffTask(stage: WorkflowStage, prior: Map<string, CompositionStageResult>): { task: string; entries: CompositionHandoff[] } {
  const entries = handoffEntries(stage, prior);
  return {
    task: entries.length ? `${stage.task}\n\nDeclared handoff:\n${JSON.stringify(entries)}` : stage.task,
    entries,
  };
}

function persistableStageResult(result: CompositionStageResult): CompositionStageResult {
  const persisted: CompositionStageResult = {
    ...result,
    ...(result.diagnostic === undefined
      ? {}
      : { diagnostic: redactSecrets(result.diagnostic) }),
    ...(result.handoff === undefined
      ? {}
      : {
          handoff: result.handoff.map((entry) => ({
            ...entry,
            context: Object.fromEntries(
              Object.entries(entry.context).map(([key, value]) => [
                key,
                typeof value === "string" ? redactSecrets(value) : value,
              ]),
            ),
          })),
        }),
  };
  if (result.execution === null) return persisted;
  return {
    ...persisted,
    execution: {
      ...result.execution,
      stdout: redactSecrets(result.execution.stdout),
      stderr: redactSecrets(result.execution.stderr),
      ...(result.execution.error === undefined
        ? {}
        : { error: redactSecrets(result.execution.error) }),
    },
  };
}

function safeDiagnostic(error: unknown, fallback: string): string {
  return redactSecrets(error instanceof Error ? error.message : fallback);
}

function safeExecution(execution: ExecutionResult): ExecutionResult {
  return {
    ...execution,
    stdout: redactSecrets(execution.stdout),
    stderr: redactSecrets(execution.stderr),
    ...(execution.error === undefined
      ? {}
      : { error: redactSecrets(execution.error) }),
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
    // A missing artifact is reported at the stage boundary. The producer
    // result remains inspectable even when its declared output is absent.
    return `${declaration.name} is missing`;
  }
  return undefined;
}

async function materializeArtifact(
  sourceWorkspace: string,
  targetWorkspace: string,
  declaration: WorkflowArtifact,
): Promise<void> {
  if (declaration.kind === "metadata" || declaration.path === undefined) return;
  const source = resolve(sourceWorkspace, declaration.path);
  const target = resolve(targetWorkspace, declaration.path);
  await mkdir(dirname(target), { recursive: true, mode: 0o700 });
  await cp(source, target, {
    recursive: declaration.kind === "directory",
    dereference: true,
    force: true,
  });
}

async function stageWorkspace(): Promise<string> {
  return mkdtemp(join(tmpdir(), "switchyard-stage-"));
}

export async function executeWorkflow(options: CompositionOptions): Promise<CompositionResult> {
  let workflow: ValidatedWorkflow;
  try { workflow = assertWorkflow(options.workflow); }
  catch (error) {
    const statePath = options.statePath ?? join(typeof (options.workflow as { workspace?: unknown })?.workspace === "string" ? (options.workflow as { workspace: string }).workspace : process.cwd(), "switchyard-workflow-state.json");
    return { workflowId: "invalid", status: "invalid-input", stages: [], statePath };
  }
  const createdWorkspace = await mkdir(workflow.workspace, { recursive: true, mode: 0o700 });
  if (createdWorkspace !== undefined) await chmod(createdWorkspace, 0o700);
  const statePath = options.statePath ?? join(workflow.workspace, "switchyard-workflow-state.json");
  await mkdir(dirname(resolve(statePath)), { recursive: true, mode: 0o700 });
  const results: CompositionStageResult[] = [];
  const byId = new Map<string, CompositionStageResult>();
  const persist = async (status: "running" | "failed" | "succeeded") => {
    const absoluteStatePath = resolve(statePath);
    const temporaryStatePath = join(
      dirname(absoluteStatePath),
      `.${basename(absoluteStatePath)}.tmp-${process.pid}-${Date.now()}`,
    );
    const state: CompositionState = {
      schemaVersion: COMPOSITION_STATE_SCHEMA_VERSION,
      workflowId: workflow.id,
      status,
      stages: results.map(persistableStageResult),
    };
    await writeFile(
      temporaryStatePath,
      JSON.stringify(state, null, 2),
      { mode: 0o600 },
    );
    await rename(temporaryStatePath, absoluteStatePath);
  };
  for (const id of workflow.order) {
    const stage = workflow.stages.find((x) => x.id === id)!;
    if ((stage.dependsOn ?? []).some((dep) => byId.get(dep)?.status !== "succeeded")) {
      const skipped: CompositionStageResult = { stageId: id, status: "skipped", selectedHarness: null, execution: null, artifacts: [], diagnostic: "dependency did not succeed" };
      results.push(skipped);
      byId.set(id, skipped);
      await persist("running");
      continue;
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
      const failed: CompositionStageResult = {
        stageId: id,
        status: "failed",
        selectedHarness: null,
        execution: null,
        artifacts: [],
        diagnostic: redactSecrets(missingArtifact),
      };
      results.push(failed); byId.set(id, failed);
      await persist("running");
      continue;
    }
    let adapter: HarnessAdapter | undefined;
    try {
      adapter = await adapterFor(options, stage);
    } catch (error) {
      const failed: CompositionStageResult = {
        stageId: id,
        status: "failed",
        selectedHarness: null,
        execution: null,
        artifacts: [],
        diagnostic: safeDiagnostic(error, "adapter selection failed"),
      };
      results.push(failed);
      byId.set(id, failed);
      await persist("running");
      continue;
    }
    if (!adapter || !adapter.supportedOperations.execute) {
      const failed: CompositionStageResult = {
        stageId: id,
        status: "failed",
        selectedHarness: adapter?.id ?? null,
        execution: null,
        artifacts: [],
        diagnostic: "no eligible adapter supports execute",
      };
      results.push(failed); byId.set(id, failed); await persist("running"); continue;
    }
    const handoff = handoffTask(stage, byId);
    const cwd = await stageWorkspace();
    let started = false;
    try {
      for (const input of stage.inputs ?? []) {
        if (!input.artifact) continue;
        const source = workflow.stages.find((candidate) => candidate.id === input.fromStage)!;
        const declaration = source.outputs!.find((artifact) => artifact.name === input.artifact)!;
        await materializeArtifact(workflow.workspace, cwd, declaration);
      }
      const running: CompositionStageResult = {
        stageId: id,
        status: "running",
        selectedHarness: adapter.id,
        execution: null,
        artifacts: [],
        ...(handoff.entries.length ? { handoff: handoff.entries } : {}),
      };
      results.push(running);
      byId.set(id, running);
      started = true;
      await persist("running");

      let completed: CompositionStageResult;
      try {
        const execution = await adapter.execute({
          task: handoff.task,
          cwd,
          environmentPolicy: { inherit: false },
          nonInteractive: true,
        });
        const safeResult = safeExecution(execution);
        let outputDiagnostic: string | undefined;
        if (safeResult.succeeded) {
          for (const declaration of stage.outputs ?? []) {
            const diagnostic = await artifactAvailability(cwd, declaration);
            if (diagnostic !== undefined) {
              outputDiagnostic = `declared output ${diagnostic}`;
              break;
            }
          }
        }
        if (safeResult.succeeded && outputDiagnostic === undefined) {
          try {
            for (const declaration of stage.outputs ?? []) {
              await materializeArtifact(cwd, workflow.workspace, declaration);
            }
          } catch (error) {
            outputDiagnostic = safeDiagnostic(error, "declared output could not be persisted");
          }
        }
        completed = {
          stageId: id,
          status: safeResult.succeeded && outputDiagnostic === undefined ? "succeeded" : "failed",
          selectedHarness: adapter.id,
          execution: safeResult,
          artifacts: safeResult.succeeded && outputDiagnostic === undefined
            ? (stage.outputs ?? []).map(copyArtifact)
            : [],
          ...(handoff.entries.length ? { handoff: handoff.entries } : {}),
          ...(!safeResult.succeeded || outputDiagnostic !== undefined
            // `stderr` is captured for the stage result, but is not a safe
            // cross-stage diagnostic because it may contain credentials or
            // other sensitive harness output.
            ? {
                diagnostic: redactSecrets(
                  outputDiagnostic ?? safeResult.error ?? `execution ${safeResult.failureCategory}`,
                ),
              }
            : {}),
        };
      } catch (error) {
        completed = {
          stageId: id,
          status: "failed",
          selectedHarness: adapter.id,
          execution: null,
          artifacts: [],
          ...(handoff.entries.length ? { handoff: handoff.entries } : {}),
          diagnostic: safeDiagnostic(error, "adapter execution failed"),
        };
      }
      results[results.length - 1] = completed;
      byId.set(id, completed);
      await persist("running");
    } catch (error) {
      if (started) throw error;
      const setupFailed: CompositionStageResult = {
        stageId: id,
        status: "failed",
        selectedHarness: adapter.id,
        execution: null,
        artifacts: [],
        ...(handoff.entries.length ? { handoff: handoff.entries } : {}),
        diagnostic: safeDiagnostic(error, "stage workspace setup failed"),
      };
      results.push(setupFailed);
      byId.set(id, setupFailed);
      await persist("running");
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  }
  const status = results.every((x) => x.status === "succeeded") ? "succeeded" : "failed";
  await persist(status);
  return { workflowId: workflow.id, status, stages: results, statePath };
}
