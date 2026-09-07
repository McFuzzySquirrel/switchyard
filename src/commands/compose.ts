import { readFile } from "node:fs/promises";

import {
  executeWorkflow,
  validateWorkflow,
  type CompositionResult,
  type CompositionStageResult,
  type WorkflowStage,
} from "../composition/index.ts";
import {
  createBuiltInHarnessAdapterRegistry,
  HarnessAdapterRegistry,
  type HarnessAdapter,
} from "../harness/index.ts";
import type { RegistryPath } from "../discovery/registry.ts";
import type { SchemaIssue, TaskRequirements } from "../discovery/schema.ts";
import type { CapabilityName } from "../capabilities/vocabulary.ts";
import { redactSecrets } from "../discovery/probe.ts";
import type { SwitchyardConfig } from "../config/index.ts";
import {
  explain,
  ExplainInputError,
  type ExplainCommandOptions,
} from "./explain.ts";
import { COMMAND_SCHEMA_VERSION, serializeCommandJson } from "../output/json.ts";

/**
 * `succeeded` requires every declared stage to have completed successfully;
 * anything else (a failed or skipped stage) is reported as `partial` so a
 * stage boundary is never conflated with overall workflow completion.
 */
export type ComposeCommandStatus = "success" | "partial";

export interface ComposeCommandResult {
  readonly schemaVersion: typeof COMMAND_SCHEMA_VERSION;
  readonly command: "compose";
  readonly status: ComposeCommandStatus;
  readonly workflowId: string;
  readonly statePath: string;
  readonly stages: readonly CompositionStageResult[];
}

export interface ComposeInvalidInputResult {
  readonly schemaVersion: typeof COMMAND_SCHEMA_VERSION;
  readonly command: "compose";
  readonly status: "invalid-input";
  readonly error: {
    readonly code: "invalid-input";
    readonly message: string;
    readonly issues: readonly SchemaIssue[];
  };
}

export class ComposeInputError extends Error {
  readonly issues: readonly SchemaIssue[];

  constructor(issues: readonly SchemaIssue[]) {
    super(
      `Invalid workflow: ${issues.map((issue) => `${issue.path} ${issue.message}`).join("; ")}`,
    );
    this.name = "ComposeInputError";
    this.issues = issues;
  }
}

export interface ComposeCommandOptions {
  readonly registryPath?: RegistryPath;
  /** Explicit local configuration file; `SWITCHYARD_CONFIG_PATH` is used otherwise. */
  readonly configPath?: string | URL;
  /** Pre-loaded configuration, useful for embedding and tests. */
  readonly config?: SwitchyardConfig;
  /** A parsed workflow definition. Mutually exclusive with `workflowPath`. */
  readonly workflow?: unknown;
  /** A JSON workflow file, read and parsed when `workflow` is not supplied. */
  readonly workflowPath?: string;
  readonly staleAfterMs?: number;
  readonly now?: () => Date;
  readonly env?: Readonly<Record<string, string | undefined>>;
  /**
   * Injectable adapter source for embedding and tests. Defaults to the
   * built-in, explicitly registered adapters, matching `run` and `verify`.
   */
  readonly adapters?: HarnessAdapterRegistry | readonly HarnessAdapter[];
  readonly statePath?: string;
}

function toRegistry(
  adapters: HarnessAdapterRegistry | readonly HarnessAdapter[] | undefined,
): HarnessAdapterRegistry {
  if (adapters === undefined) return createBuiltInHarnessAdapterRegistry();
  if (adapters instanceof HarnessAdapterRegistry) return adapters;
  return new HarnessAdapterRegistry(adapters);
}

/** A stage declares either full `TaskRequirements` or a bare capability list. */
function normalizeStageRequirements(stage: WorkflowStage): TaskRequirements {
  const requirements = stage.requirements;
  if (Array.isArray(requirements)) {
    return { schemaVersion: 1, requires: requirements as readonly CapabilityName[] };
  }
  return requirements as TaskRequirements;
}

async function loadWorkflowInput(options: ComposeCommandOptions): Promise<unknown> {
  if (options.workflow !== undefined) return options.workflow;
  if (options.workflowPath === undefined) {
    throw new ComposeInputError([
      { path: "$", message: "must supply a workflow or workflowPath" },
    ]);
  }
  let text: string;
  try {
    text = await readFile(options.workflowPath, "utf8");
  } catch (error) {
    throw new ComposeInputError([
      {
        path: "$.workflowPath",
        message: `could not read workflow file: ${error instanceof Error ? error.message : String(error)}`,
      },
    ]);
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new ComposeInputError([
      { path: "$.workflowPath", message: "workflow file must contain valid JSON" },
    ]);
  }
}

function composeStatus(result: CompositionResult): ComposeCommandStatus {
  return result.stages.length > 0 &&
    result.stages.every((stage) => stage.status === "succeeded")
    ? "success"
    : "partial";
}

/**
 * Runs a declared multi-stage workflow (`COMP-FR-01`..`COMP-FR-03`).
 *
 * `compose` never reimplements matching or subprocess lifecycle: the
 * workflow graph, artifact containment, and declared handoff are validated
 * by `validateWorkflow`/`executeWorkflow` (`src/composition`), each stage's
 * adapter is selected by reusing `explain` — the same deterministic routing
 * policy as `run` — and stage execution and durable per-stage state
 * persistence are delegated entirely to `executeWorkflow`.
 */
export async function compose(
  options: ComposeCommandOptions,
): Promise<ComposeCommandResult> {
  const rawWorkflow = await loadWorkflowInput(options);
  const validated = validateWorkflow(rawWorkflow);
  if (!validated.success) {
    throw new ComposeInputError(validated.issues);
  }

  const registry = toRegistry(options.adapters);

  const selectAdapter = async (
    stage: WorkflowStage,
  ): Promise<HarnessAdapter | undefined> => {
    const requirements = normalizeStageRequirements(stage);
    const explainOptions: ExplainCommandOptions = {
      ...(options.registryPath === undefined ? {} : { registryPath: options.registryPath }),
      ...(options.configPath === undefined ? {} : { configPath: options.configPath }),
      ...(options.config === undefined ? {} : { config: options.config }),
      requirements,
      ...(options.staleAfterMs === undefined ? {} : { staleAfterMs: options.staleAfterMs }),
      ...(options.now === undefined ? {} : { now: options.now }),
      ...(options.env === undefined ? {} : { env: options.env }),
    };
    let decision: Awaited<ReturnType<typeof explain>>;
    try {
      decision = await explain(explainOptions);
    } catch (error: unknown) {
      // A stage that declares no required capabilities is rejected by
      // explain (it requires at least one). Composition stages may
      // legitimately have none, in which case there is nothing for routing
      // to select; the stage then fails with "no eligible adapter" from
      // executeWorkflow, which is the correct, already-defined outcome.
      if (error instanceof ExplainInputError) return undefined;
      throw error;
    }
    if (decision.status !== "success" || decision.selectedHarness === null) return undefined;
    return registry.get(decision.selectedHarness);
  };

  const result = await executeWorkflow({
    // Keep the external definition as the execution input. `validated.value`
    // carries the internal topological `order` field, which is deliberately
    // not part of the user-facing schema and must never become an accepted
    // workflow input on a second validation pass.
    workflow: rawWorkflow,
    adapters: new Map(registry.list().map((adapter) => [adapter.id, adapter])),
    selectAdapter,
    ...(options.statePath === undefined ? {} : { statePath: options.statePath }),
  });

  return {
    schemaVersion: COMMAND_SCHEMA_VERSION,
    command: "compose",
    status: composeStatus(result),
    workflowId: result.workflowId,
    statePath: result.statePath,
    stages: result.stages,
  };
}

export const composeCommand = compose;

export function composeInvalidInput(error: ComposeInputError): ComposeInvalidInputResult {
  return {
    schemaVersion: COMMAND_SCHEMA_VERSION,
    command: "compose",
    status: "invalid-input",
    error: {
      code: "invalid-input",
      message: redactSecrets(error.message),
      issues: error.issues.map((issue) => ({
        path: redactSecrets(issue.path),
        message: redactSecrets(issue.message),
      })),
    },
  };
}

function presentationComposeResult(
  result: ComposeCommandResult | ComposeInvalidInputResult,
): ComposeCommandResult | ComposeInvalidInputResult {
  if (result.status === "invalid-input") return result;
  return {
    ...result,
    stages: result.stages.map((stage) => ({
      ...stage,
      ...(stage.diagnostic === undefined ? {} : { diagnostic: redactSecrets(stage.diagnostic) }),
      ...(stage.execution === null
        ? {}
        : {
            execution: {
              ...stage.execution,
              stdout: redactSecrets(stage.execution.stdout),
              stderr: redactSecrets(stage.execution.stderr),
              ...(stage.execution.error === undefined
                ? {}
                : { error: redactSecrets(stage.execution.error) }),
            },
          }),
    })),
  };
}

export function formatComposeJson(
  result: ComposeCommandResult | ComposeInvalidInputResult,
): string {
  return serializeCommandJson(presentationComposeResult(result));
}

export function formatComposeHuman(
  result: ComposeCommandResult | ComposeInvalidInputResult,
): string {
  const presented = presentationComposeResult(result);
  if (presented.status === "invalid-input") {
    return [
      "Switchyard compose",
      "Status: invalid-input",
      `Error: ${presented.error.message}`,
    ].join("\n");
  }

  const lines = [
    "Switchyard compose",
    `Workflow: ${presented.workflowId}`,
    `Status: ${presented.status}`,
    `State: ${presented.statePath}`,
    "Stages:",
  ];
  for (const stage of presented.stages) {
    lines.push(
      `- ${stage.stageId}: ${stage.status}${stage.selectedHarness ? ` [harness: ${stage.selectedHarness}]` : ""}`,
    );
    if (stage.diagnostic !== undefined) lines.push(`  diagnostic: ${stage.diagnostic}`);
    if (stage.artifacts.length > 0) {
      lines.push(`  artifacts: ${stage.artifacts.map((artifact) => artifact.name).join(", ")}`);
    }
  }
  return lines.join("\n");
}
