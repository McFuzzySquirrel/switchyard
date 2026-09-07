import type { CapabilityName } from "../capabilities/vocabulary.ts";
import type { HarnessProfile } from "../discovery/schema.ts";

export type AdapterOperation =
  | "discover"
  | "verify"
  | "execute"
  | "resume"
  | "fork";

export type SupportedOperations = Readonly<
  Record<AdapterOperation, boolean>
>;
export type AdapterOperationSupport = SupportedOperations;

export interface ProbeContext {
  readonly cwd?: string;
  readonly timeoutMs?: number;
  readonly nonInteractive?: boolean;
}

export interface VerificationResult {
  readonly capability: CapabilityName;
  readonly status: "passed" | "failed" | "skipped" | "timed-out" | "unavailable";
  readonly completedAt: string;
  readonly message?: string;
}

export interface ExecutionRequest {
  readonly task: string;
  readonly cwd?: string;
  readonly timeoutMs?: number;
  readonly dryRun?: boolean;
}

export interface ExecutionResult {
  readonly succeeded: boolean;
  readonly exitCode?: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly durationMs: number;
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
