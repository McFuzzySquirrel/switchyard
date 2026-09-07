import type { CapabilityName } from "../capabilities/vocabulary.ts";
import type { HarnessProfile } from "../discovery/schema.ts";
import {
  assertOperationSupported,
  type AdapterOperation,
  type ExecutionRequest,
  type ExecutionResult,
  type ForkRequest,
  type ForkResult,
  type HarnessAdapter,
  type ProbeContext,
  type ResumeRequest,
  type SupportedOperations,
  type VerificationResult,
} from "./adapter.ts";

/**
 * One recorded invocation of a supported operation. Used by conformance
 * tests to prove that every operation on a single adapter instance observed
 * the same resolved executable, and that an unsupported operation never
 * reaches this point.
 */
export interface StubHarnessAdapterCall {
  readonly operation: AdapterOperation;
  readonly executable: string;
  readonly at: string;
}

export interface StubHarnessAdapterOptions {
  readonly id?: string;
  readonly displayName?: string;
  /** The single resolved executable every operation on this instance uses. */
  readonly executable?: string;
  /**
   * Overrides the default supported-operation matrix. `fork` is unsupported
   * by default so conformance suites can exercise the fail-fast path
   * without additional configuration.
   */
  readonly supportedOperations?: Partial<SupportedOperations>;
  readonly profile?: Partial<HarnessProfile>;
  readonly now?: () => Date;
}

export interface StubHarnessAdapter extends HarnessAdapter {
  /** Append-only log of operations that actually ran (never unsupported ones). */
  readonly calls: readonly StubHarnessAdapterCall[];
}

const DEFAULT_SUPPORTED_OPERATIONS: SupportedOperations = Object.freeze({
  discover: true,
  verify: true,
  execute: true,
  resume: true,
  fork: false,
});

/**
 * A reusable adapter conformance fixture. It implements the full
 * `HarnessAdapter` contract (discovery, verification, execution, resume,
 * and fork) without any vendor process, so integration suites can register
 * it through the same `HarnessAdapterRegistry` used by built-in adapters
 * and prove the contract works without any matcher change.
 *
 * `fork` is unsupported by default, which lets one instance demonstrate
 * both the success path and the fail-before-launch unsupported-operation
 * path with a single registration.
 */
export function createStubHarnessAdapter(
  options: StubHarnessAdapterOptions = {},
): StubHarnessAdapter {
  const id = options.id ?? "stub";
  const displayName = options.displayName ?? "Stub Harness";
  const executable = options.executable ?? `/fixtures/${id}`;
  const supportedOperations: SupportedOperations = Object.freeze({
    ...DEFAULT_SUPPORTED_OPERATIONS,
    ...options.supportedOperations,
  });
  const now = options.now ?? (() => new Date());
  const calls: StubHarnessAdapterCall[] = [];

  function record(operation: AdapterOperation): void {
    calls.push({ operation, executable, at: now().toISOString() });
  }

  const adapter: StubHarnessAdapter = {
    id,
    supportedOperations,
    calls,
    async discover(): Promise<HarnessProfile> {
      assertOperationSupported(adapter, "discover");
      record("discover");
      const checkedAt = now().toISOString();
      return {
        schemaVersion: 1,
        id,
        displayName,
        executable,
        executableSource: "override",
        capabilities: [],
        status: "available",
        lifecycle: "registered",
        availability: { status: "available", checkedAt },
        discoveredAt: checkedAt,
        updatedAt: checkedAt,
        ...options.profile,
      };
    },
    async verify(
      capabilities: readonly CapabilityName[],
      _context: ProbeContext,
    ): Promise<readonly VerificationResult[]> {
      assertOperationSupported(adapter, "verify");
      record("verify");
      const startedAt = now().toISOString();
      const completedAt = now().toISOString();
      return capabilities.map((capability) => ({
        schemaVersion: 1 as const,
        capability,
        status: "passed" as const,
        startedAt,
        completedAt,
      }));
    },
    async execute(request: ExecutionRequest): Promise<ExecutionResult> {
      assertOperationSupported(adapter, "execute");
      record("execute");
      return {
        succeeded: request.dryRun !== true,
        status: request.dryRun === true ? "dry-run" : "succeeded",
        failureCategory: "none",
        exitCode: request.dryRun === true ? null : 0,
        stdout: request.dryRun === true ? "" : `stub executed: ${request.task}`,
        stderr: "",
        stdoutTruncated: false,
        stderrTruncated: false,
        durationMs: 0,
      };
    },
    async resume(request: ResumeRequest): Promise<ExecutionResult> {
      assertOperationSupported(adapter, "resume");
      record("resume");
      return {
        succeeded: true,
        status: "succeeded",
        failureCategory: "none",
        exitCode: 0,
        stdout: `stub resumed: ${request.sessionId}`,
        stderr: "",
        stdoutTruncated: false,
        stderrTruncated: false,
        durationMs: 0,
      };
    },
    async fork(request: ForkRequest): Promise<ForkResult> {
      assertOperationSupported(adapter, "fork");
      record("fork");
      return {
        sessionId: `${id}-fork-${request.sessionId}`,
        completedAt: now().toISOString(),
      };
    },
  };

  return Object.freeze(adapter);
}
