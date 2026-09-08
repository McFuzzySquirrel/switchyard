import type { CapabilityName } from "../capabilities/vocabulary.ts";
import type { HarnessProfile } from "../discovery/schema.ts";
import type { VerificationResult } from "../verification/schema.ts";
export type { VerificationResult } from "../verification/schema.ts";

export type AdapterOperation =
  | "discover"
  | "verify"
  | "execute"
  | "resume"
  | "fork";

/** Stable, vendor-neutral operation vocabulary shared by every adapter. */
export const ADAPTER_OPERATION_NAMES = Object.freeze([
  "discover",
  "verify",
  "execute",
  "resume",
  "fork",
] as const satisfies readonly AdapterOperation[]);

export type SupportedOperations = Readonly<Record<AdapterOperation, boolean>>;
export type AdapterOperationSupport = SupportedOperations;
/** Compatibility name for consumers that call the declaration an operation schema. */
export type OperationSupport = SupportedOperations;

export interface OperationSupportIssue {
  readonly path: string;
  readonly message: string;
}

export type OperationSupportValidationResult =
  | {
      readonly success: true;
      readonly value: SupportedOperations;
      readonly issues: readonly [];
    }
  | {
      readonly success: false;
      readonly issues: readonly OperationSupportIssue[];
    };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Runtime schema for the operation-support declaration carried by an adapter.
 * Keeping this check at the boundary prevents misspelled operations or
 * truthy non-boolean values from silently changing routing behaviour.
 */
export function validateOperationSupport(
  input: unknown,
): OperationSupportValidationResult {
  if (!isRecord(input)) {
    return {
      success: false,
      issues: [{ path: "$", message: "must be an object" }],
    };
  }

  const issues: OperationSupportIssue[] = [];
  for (const key of Object.keys(input)) {
    if (!(ADAPTER_OPERATION_NAMES as readonly string[]).includes(key)) {
      issues.push({
        path: `$.${key}`,
        message: "is not a supported adapter operation",
      });
    }
  }
  for (const operation of ADAPTER_OPERATION_NAMES) {
    if (!(operation in input)) {
      issues.push({
        path: `$.${operation}`,
        message: "is required",
      });
    } else if (typeof input[operation] !== "boolean") {
      issues.push({
        path: `$.${operation}`,
        message: "must be a boolean",
      });
    }
  }

  if (issues.length > 0) {
    return { success: false, issues };
  }

  return {
    success: true,
    value: Object.freeze({
      discover: input.discover as boolean,
      verify: input.verify as boolean,
      execute: input.execute as boolean,
      resume: input.resume as boolean,
      fork: input.fork as boolean,
    }),
    issues: [],
  };
}

export function isOperationSupport(input: unknown): input is SupportedOperations {
  return validateOperationSupport(input).success;
}

export function assertOperationSupport(input: unknown): SupportedOperations {
  const result = validateOperationSupport(input);
  if (!result.success) {
    throw new Error(
      `OperationSupport validation failed: ${result.issues
        .map((issue) => `${issue.path} ${issue.message}`)
        .join("; ")}`,
    );
  }
  return result.value;
}

/** Explicit aliases for callers that use the plural schema terminology. */
export const validateSupportedOperations = validateOperationSupport;
export const isSupportedOperations = isOperationSupport;
export const assertSupportedOperations = assertOperationSupport;

export interface ProbeContext {
  readonly cwd?: string;
  readonly timeoutMs?: number;
  /** Cancellation signal for a bounded verification probe. */
  readonly signal?: AbortSignal;
  readonly nonInteractive?: boolean;
  /** Risk classes must be declared before verification is launched. */
  readonly probeRisks?: readonly (
    | "read-only"
    | "mutating"
    | "external-access"
    | "paid"
    | "model-invoking"
  )[];
  readonly probePolicy?: {
    readonly allowReadOnly?: boolean;
    readonly allowMutatingProbes?: boolean;
    readonly allowExternalAccess?: boolean;
    readonly allowPaidProbes?: boolean;
    readonly allowModelInvocation?: boolean;
  };
}

/**
 * Explicit environment inheritance controls for an execution request.
 *
 * `inherit` controls whether the runner starts with the parent environment.
 * `allow` and `deny` are applied to inherited names before `env` overrides
 * individual values. Implementations must use an allow-list when credentials
 * or other sensitive parent variables should not cross the process boundary;
 * these fields describe policy and must not be serialized as secret values.
 */
export interface ExecutionEnvironmentPolicy {
  readonly inherit?: boolean;
  readonly allow?: readonly string[];
  readonly deny?: readonly string[];
}

/**
 * Stable categories used by execution consumers. Routing/input categories are
 * included because a command can return an execution-shaped result without
 * launching a process (for example, a dry-run or a rejected selection).
 */
export type ExecutionFailureCategory =
  | "none"
  | "invalid-input"
  | "no-match"
  | "unavailable"
  | "execution-failure"
  | "timeout"
  | "cancelled";

/** Lifecycle status for an adapter execution result. */
export type ExecutionResultStatus =
  | "succeeded"
  | "failed"
  | "timed-out"
  | "cancelled"
  | "unavailable"
  | "dry-run";

export interface ExecutionRequest {
  /** User task passed to the selected adapter through its safe transport. */
  readonly task: string;
  /** Controlled working directory for the adapter process. */
  readonly cwd?: string;
  /**
   * Explicit environment values. Values are merged only after the runner
   * applies `environmentPolicy`; credentials must never be copied here.
   */
  readonly env?: Readonly<Record<string, string | undefined>>;
  /** Allow/deny policy for inherited environment names. */
  readonly environmentPolicy?: ExecutionEnvironmentPolicy;
  /** Controlled stdin payload when the adapter supports stdin transport. */
  readonly stdin?: string;
  /** Maximum time allowed for the process and its descendants. */
  readonly timeoutMs?: number;
  /** Maximum captured characters for each output stream. */
  readonly maxOutputLength?: number;
  /** Cancellation signal for the process tree. */
  readonly signal?: AbortSignal;
  /** Force non-interactive behavior; adapters must not prompt when enabled. */
  readonly nonInteractive?: boolean;
  /** Describe the request without launching the selected task. */
  readonly dryRun?: boolean;
}

export interface ExecutionResult {
  /** True only when the task completed successfully. */
  readonly succeeded: boolean;
  /** Stable lifecycle status, including timeout/cancellation distinctions. */
  readonly status: ExecutionResultStatus;
  /** Stable category for a failure, or `none` when no failure occurred. */
  readonly failureCategory: ExecutionFailureCategory;
  /** Null when no process exit code exists (spawn failure, timeout, cancellation, or dry-run). */
  readonly exitCode: number | null;
  /** Signal that terminated the process, when the platform reports one. */
  readonly signal?: string;
  readonly stdout: string;
  readonly stderr: string;
  /** Whether each bounded stream was truncated before returning. */
  readonly stdoutTruncated: boolean;
  readonly stderrTruncated: boolean;
  readonly durationMs: number;
  /** Redacted, actionable process diagnostic; never raw credentials. */
  readonly error?: string;
}

export interface ResumeRequest {
  readonly sessionId: string;
  readonly task?: string;
}

export interface ForkRequest {
  readonly sessionId: string;
  readonly task?: string;
}

export interface ForkResult {
  readonly sessionId: string;
  readonly completedAt: string;
}

/**
 * Narrow operation contracts. Keeping each operation as a separate interface
 * lets a subsystem depend on the smallest vendor boundary it needs while
 * `HarnessAdapter` below composes the complete contract. New adapters can
 * implement only the operations they actually support without introducing
 * vendor conditionals into routing.
 */
export interface DiscoveryAdapter {
  readonly id: string;
  readonly supportedOperations: SupportedOperations;
  discover(): Promise<HarnessProfile>;
}

export interface VerificationAdapter {
  readonly id: string;
  readonly supportedOperations: SupportedOperations;
  verify(
    capabilities: readonly CapabilityName[],
    context: ProbeContext,
  ): Promise<readonly VerificationResult[]>;
}

export interface ExecutionAdapter {
  readonly id: string;
  readonly supportedOperations: SupportedOperations;
  execute(request: ExecutionRequest): Promise<ExecutionResult>;
}

export interface ResumeAdapter {
  readonly id: string;
  readonly supportedOperations: SupportedOperations;
  resume(request: ResumeRequest): Promise<ExecutionResult>;
}

export interface ForkAdapter {
  readonly id: string;
  readonly supportedOperations: SupportedOperations;
  fork(request: ForkRequest): Promise<ForkResult>;
}

// More explicit aliases for consumers that prefer the Harness-prefixed names.
export type HarnessVerificationAdapter = VerificationAdapter;
export type HarnessExecutionAdapter = ExecutionAdapter;
export type HarnessResumeAdapter = ResumeAdapter;
export type HarnessForkAdapter = ForkAdapter;

/**
 * Vendor-neutral adapter boundary. Discovery schemas are shared with the
 * registry; invocation and process lifecycle remain adapter/runtime concerns.
 *
 * A concrete adapter is constructed with its resolved runtime configuration
 * (executable location, environment, probe policy) already bound by closure.
 * Every operation on the same instance must therefore observe the same
 * resolved executable: an override that only reaches `discover()` and not
 * `verify()`/`execute()` is a contract violation, not an implementation
 * detail, because callers select and invoke harnesses from one profile.
 */
export interface HarnessAdapter
  extends DiscoveryAdapter,
    VerificationAdapter,
    ExecutionAdapter,
    ResumeAdapter,
    ForkAdapter {}

/**
 * Declares only `discover` as supported. Discovery-only adapters (and
 * built-in adapters whose execution counterpart does not exist yet) must
 * reuse this constant rather than redeclaring the shape, so every adapter
 * reports the same accurate, vendor-neutral operation vocabulary.
 */
export const DISCOVERY_ONLY_OPERATIONS: SupportedOperations = Object.freeze({
  discover: true,
  verify: false,
  execute: false,
  resume: false,
  fork: false,
});

/** Built-in provider adapters support bounded, direct prompt execution. */
export const DISCOVERY_AND_EXECUTION_OPERATIONS: SupportedOperations = Object.freeze({
  discover: true,
  verify: false,
  execute: true,
  resume: false,
  fork: false,
});

/**
 * Raised when an operation is invoked on an adapter that has not declared
 * support for it. The message never includes request/response payloads, so
 * it stays safe to surface directly to users and logs.
 */
export class UnsupportedOperationError extends Error {
  readonly adapterId: string;
  readonly operation: AdapterOperation;

  constructor(adapterId: string, operation: AdapterOperation, message?: string) {
    super(
      message ??
        `Harness adapter '${adapterId}' does not support the '${operation}' operation`,
    );
    this.name = "UnsupportedOperationError";
    this.adapterId = adapterId;
    this.operation = operation;
  }
}

/**
 * Fails an unsupported operation immediately, before any process launch or
 * other adapter work. Adapters with a fixed, permanently-unsupported
 * operation should call this directly from that method; the `never` return
 * type lets it satisfy any method's return type without dead-code returns.
 */
export function throwUnsupportedOperation(
  adapterId: string,
  operation: AdapterOperation,
): never {
  throw new UnsupportedOperationError(adapterId, operation);
}

/**
 * Guards an operation whose support may vary per adapter instance (for
 * example, a stub or future adapter that supports `resume` but not `fork`).
 * Centralizing the check here means no adapter or matcher needs its own
 * unsupported-operation branching logic: every adapter fails the same way.
 */
export function assertOperationSupported(
  adapter: Pick<HarnessAdapter, "id" | "supportedOperations">,
  operation: AdapterOperation,
): void {
  if (adapter.supportedOperations[operation]) {
    return;
  }
  throwUnsupportedOperation(adapter.id, operation);
}
