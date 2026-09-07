import {
  createBuiltInHarnessAdapterRegistry,
  HarnessAdapterRegistry,
  UnsupportedOperationError,
  type ExecutionEnvironmentPolicy,
  type ExecutionRequest,
  type ExecutionResult,
  type HarnessAdapter,
} from "../harness/index.ts";
import type { RegistryPath } from "../discovery/registry.ts";
import type { SchemaIssue, TaskRequirements } from "../discovery/schema.ts";
import { redactSecrets } from "../discovery/probe.ts";
import type { SwitchyardConfig } from "../config/index.ts";
import {
  explain,
  ExplainInputError,
  type ExplainCommandOptions,
  type ExplainPolicy,
} from "./explain.ts";
import { COMMAND_SCHEMA_VERSION, serializeCommandJson } from "../output/json.ts";

/**
 * Stable status categories for `run`. `dry-run` is reported distinctly from
 * `success` because no task was actually launched; every other variant
 * matches the execution-runtime failure taxonomy required by EXEC-FR-06.
 * `invalid-input` is carried only by {@link RunInvalidInputResult}; it is
 * excluded from {@link RunCommandResult} so its `status` field always
 * reflects a request that reached routing.
 */
export type RunCommandStatus =
  | "success"
  | "dry-run"
  | "no-match"
  | "invalid-input"
  | "unavailable"
  | "execution-failure";

export type RunResultStatus = Exclude<RunCommandStatus, "invalid-input">;

export interface RunSelection {
  readonly harnessId: string;
  readonly reason: string;
}

export interface RunCommandResult {
  readonly schemaVersion: typeof COMMAND_SCHEMA_VERSION;
  readonly command: "run";
  readonly status: RunResultStatus;
  readonly registryPath: string;
  readonly requirements: TaskRequirements;
  readonly task: string;
  readonly dryRun: boolean;
  readonly selectedHarness: string | null;
  readonly selection: RunSelection | null;
  /** The pure routing policy and qualifying attempts used before execution. */
  readonly policy: ExplainPolicy;
  readonly reason: string;
  /** Null only when routing never reached execution (no-match). */
  readonly execution: ExecutionResult | null;
}

export interface RunInvalidInputResult {
  readonly schemaVersion: typeof COMMAND_SCHEMA_VERSION;
  readonly command: "run";
  readonly status: "invalid-input";
  readonly error: {
    readonly code: "invalid-input";
    readonly message: string;
    readonly issues: readonly SchemaIssue[];
  };
}

export class RunInputError extends Error {
  readonly issues: readonly SchemaIssue[];

  constructor(issues: readonly SchemaIssue[]) {
    super(
      `Invalid run input: ${issues
        .map((issue) => `${issue.path} ${issue.message}`)
        .join("; ")}`,
    );
    this.name = "RunInputError";
    this.issues = issues;
  }
}

export interface RunCommandOptions {
  readonly registryPath?: RegistryPath;
  /** Explicit local configuration file; `SWITCHYARD_CONFIG_PATH` is used otherwise. */
  readonly configPath?: string | URL;
  /** Pre-loaded configuration, useful for embedding and tests. */
  readonly config?: SwitchyardConfig;
  readonly requirements: unknown;
  /** Task text delivered to the selected adapter through its safe transport. */
  readonly task: string;
  /** Controlled working directory for the adapter process. */
  readonly cwd?: string;
  /** Explicit environment values merged after the adapter's environment policy. */
  readonly env?: Readonly<Record<string, string | undefined>>;
  /** Explicit inherited-environment allow/deny policy for the adapter process. */
  readonly environmentPolicy?: ExecutionEnvironmentPolicy;
  /** Controlled stdin payload, when the selected adapter supports it. */
  readonly stdin?: string;
  readonly timeoutMs?: number;
  readonly maxOutputLength?: number;
  /** Cancellation signal for the process tree. */
  readonly signal?: AbortSignal;
  /** Defaults to `true`: switchyard is a non-interactive, scriptable CLI. */
  readonly nonInteractive?: boolean;
  /** Describe the routed selection without launching the selected task. */
  readonly dryRun?: boolean;
  readonly staleAfterMs?: number;
  readonly now?: () => Date;
  /**
   * Injectable adapter source for embedding and tests. Defaults to the
   * built-in, explicitly registered adapters. Accepts either a prepared
   * registry or a plain adapter list.
   */
  readonly adapters?: HarnessAdapterRegistry | readonly HarnessAdapter[];
}

function toRegistry(
  adapters: HarnessAdapterRegistry | readonly HarnessAdapter[] | undefined,
): HarnessAdapterRegistry {
  if (adapters === undefined) return createBuiltInHarnessAdapterRegistry();
  if (adapters instanceof HarnessAdapterRegistry) return adapters;
  return new HarnessAdapterRegistry(adapters);
}

function unavailableExecutionResult(message: string): ExecutionResult {
  return {
    succeeded: false,
    status: "unavailable",
    failureCategory: "unavailable",
    exitCode: null,
    stdout: "",
    stderr: "",
    stdoutTruncated: false,
    stderrTruncated: false,
    durationMs: 0,
    error: redactSecrets(message),
  };
}

function dryRunExecutionResult(): ExecutionResult {
  return {
    succeeded: false,
    status: "dry-run",
    failureCategory: "none",
    exitCode: null,
    stdout: "",
    stderr: "",
    stdoutTruncated: false,
    stderrTruncated: false,
    durationMs: 0,
  };
}

function runStatusFor(execution: ExecutionResult): RunResultStatus {
  if (execution.status === "dry-run") return "dry-run";
  if (execution.succeeded) return "success";
  if (execution.status === "unavailable" || execution.failureCategory === "unavailable") {
    return "unavailable";
  }
  return "execution-failure";
}

/**
 * Connects a deterministic routing decision to adapter execution. `run`
 * never implements matching or ranking itself: it reuses `explain` for
 * selection, then hands the already-selected harness and a normalized
 * `ExecutionRequest` to the adapter registered for that harness ID. An
 * adapter that has not declared `execute` support is rejected before any
 * process is launched, and the result is reported as `unavailable` rather
 * than an uncaught exception.
 */
export async function run(options: RunCommandOptions): Promise<RunCommandResult> {
  if (typeof options.task !== "string" || options.task.trim().length === 0) {
    throw new RunInputError([
      { path: "$.task", message: "must be a non-empty string" },
    ]);
  }

  const explainOptions: ExplainCommandOptions = {
    ...(options.registryPath === undefined ? {} : { registryPath: options.registryPath }),
    ...(options.configPath === undefined ? {} : { configPath: options.configPath }),
    ...(options.config === undefined ? {} : { config: options.config }),
    requirements: options.requirements,
    ...(options.staleAfterMs === undefined ? {} : { staleAfterMs: options.staleAfterMs }),
    ...(options.now === undefined ? {} : { now: options.now }),
    ...(options.env === undefined ? {} : { env: options.env }),
    ...(options.environmentPolicy === undefined
      ? {}
      : { environmentPolicy: options.environmentPolicy }),
  };

  let decision: Awaited<ReturnType<typeof explain>>;
  try {
    decision = await explain(explainOptions);
  } catch (error: unknown) {
    if (error instanceof ExplainInputError) {
      throw new RunInputError(error.issues);
    }
    throw error;
  }

  const dryRun = options.dryRun === true;

  if (decision.status === "no-match" || decision.selectedHarness === null || decision.selection === null) {
    return {
      schemaVersion: COMMAND_SCHEMA_VERSION,
      command: "run",
      status: "no-match",
      registryPath: decision.registryPath,
      requirements: decision.requirements,
      task: options.task,
      dryRun,
      selectedHarness: null,
      selection: null,
      policy: decision.policy,
      reason: decision.reason,
      execution: null,
    };
  }

  const harnessId = decision.selectedHarness;
  const selection: RunSelection = decision.selection;

  let execution: ExecutionResult;
  // A dry run is a routing preview, not an adapter invocation. In
  // particular, do not call `execute({ dryRun: true })`: an adapter cannot
  // be trusted to implement that flag without launching its vendor process.
  // This also lets callers preview a selection before installing/registering
  // the selected harness.
  if (dryRun) {
    execution = dryRunExecutionResult();
  } else {
    const registry = toRegistry(options.adapters);
    const adapter = registry.get(harnessId);
    if (adapter === undefined) {
      execution = unavailableExecutionResult(
        `Harness '${harnessId}' is selected but not registered for execution`,
      );
    } else if (!adapter.supportedOperations.execute) {
      execution = unavailableExecutionResult(
        `Harness '${harnessId}' does not support the 'execute' operation`,
      );
    } else {
      const request: ExecutionRequest = {
        task: options.task,
        ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
        ...(options.env === undefined ? {} : { env: options.env }),
        ...(options.stdin === undefined ? {} : { stdin: options.stdin }),
        ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
        ...(options.maxOutputLength === undefined
          ? {}
          : { maxOutputLength: options.maxOutputLength }),
        ...(options.signal === undefined ? {} : { signal: options.signal }),
        nonInteractive: options.nonInteractive ?? true,
        dryRun: false,
      };
      try {
        execution = await adapter.execute(request);
      } catch (error: unknown) {
        if (error instanceof UnsupportedOperationError) {
          execution = unavailableExecutionResult(error.message);
        } else {
          throw error;
        }
      }
    }
  }

  return {
    schemaVersion: COMMAND_SCHEMA_VERSION,
    command: "run",
    status: runStatusFor(execution),
    registryPath: decision.registryPath,
    requirements: decision.requirements,
    task: options.task,
    dryRun,
    selectedHarness: harnessId,
    selection,
    policy: decision.policy,
    reason: decision.reason,
    execution,
  };
}

export const runCommand = run;
export const runTask = run;

export function runInvalidInput(error: RunInputError): RunInvalidInputResult {
  return {
    schemaVersion: COMMAND_SCHEMA_VERSION,
    command: "run",
    status: "invalid-input",
    error: {
      code: "invalid-input",
      message: redactSecrets(error.message),
      issues: error.issues,
    },
  };
}

function presentationRunResult(
  result: RunCommandResult | RunInvalidInputResult,
): RunCommandResult | RunInvalidInputResult {
  if (result.status === "invalid-input") {
    return {
      ...result,
      error: {
        ...result.error,
        message: redactSecrets(result.error.message),
        issues: result.error.issues.map((issue) => ({
          ...issue,
          path: redactSecrets(issue.path),
          message: redactSecrets(issue.message),
        })),
      },
    };
  }

  return {
    ...result,
    task: redactSecrets(result.task),
    reason: redactSecrets(result.reason),
    execution: result.execution === null
      ? null
      : {
          ...result.execution,
          stdout: redactSecrets(result.execution.stdout),
          stderr: redactSecrets(result.execution.stderr),
          ...(result.execution.error === undefined
            ? {}
            : { error: redactSecrets(result.execution.error) }),
        },
  };
}

export function formatRunJson(result: RunCommandResult | RunInvalidInputResult): string {
  return serializeCommandJson(presentationRunResult(result));
}

export function formatRunHuman(result: RunCommandResult | RunInvalidInputResult): string {
  result = presentationRunResult(result);
  if (result.status === "invalid-input") {
    return [
      "Switchyard run",
      "Status: invalid-input",
      `Error: ${result.error.message}`,
    ].join("\n");
  }

  const lines = [
    "Switchyard run",
    `Registry: ${result.registryPath}`,
    `Status: ${result.status}`,
    `Task: ${result.task}`,
    `Dry run: ${result.dryRun ? "yes" : "no"}`,
    `Requirements: ${result.requirements.requires.join(", ")}`,
    `Policy: preferred=${result.policy.preferredHarness ?? "none"}; fallback=${result.policy.allowFallback ? "enabled" : "disabled"}; fallback-used=${result.policy.fallbackUsed ? "yes" : "no"}`,
    `Attempts: ${result.policy.attempts.length === 0
      ? "none"
      : result.policy.attempts
        .map((attempt) => `${attempt.harnessId} [role: ${attempt.role}; qualifies: ${attempt.qualifies ? "yes" : "no"}; selected: ${attempt.selected ? "yes" : "no"}; missing: ${attempt.missing.join(", ") || "none"}]`)
        .join("; ")}`,
    `Selection: ${result.selectedHarness ?? "none"}`,
    `Reason: ${result.reason}`,
  ];

  if (result.execution !== null) {
    const execution = result.execution;
    lines.push(
      `Execution status: ${execution.status}`,
      `Execution failure category: ${execution.failureCategory}`,
      `Exit code: ${execution.exitCode ?? "none"}`,
      `Duration: ${execution.durationMs}ms`,
    );
    if (execution.error !== undefined) {
      lines.push(`Diagnostic: ${execution.error}`);
    }
    lines.push(
      `Stdout: ${execution.stdout.length > 0 ? execution.stdout : "(empty)"}${execution.stdoutTruncated ? " [truncated]" : ""}`,
      `Stderr: ${execution.stderr.length > 0 ? execution.stderr : "(empty)"}${execution.stderrTruncated ? " [truncated]" : ""}`,
    );
  }

  return lines.join("\n");
}
