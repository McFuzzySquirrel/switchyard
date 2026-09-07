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
 * Vendor-neutral adapter boundary. Discovery schemas are shared with the
 * registry; invocation and process lifecycle remain adapter/runtime concerns.
 */
export interface HarnessAdapter {
  readonly id: string;
  readonly supportedOperations: SupportedOperations;
  discover(): Promise<HarnessProfile>;
  verify(
    capabilities: readonly CapabilityName[],
    context: ProbeContext,
  ): Promise<readonly VerificationResult[]>;
  execute(request: ExecutionRequest): Promise<ExecutionResult>;
  resume?(request: ResumeRequest): Promise<ExecutionResult>;
  fork?(request: ForkRequest): Promise<ForkResult>;
}
