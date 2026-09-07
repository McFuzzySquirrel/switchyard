import {
  assertOperationSupported,
  type HarnessVerificationAdapter,
  type ProbeContext,
  type VerificationResult,
} from "../harness/adapter.ts";
import {
  evaluateProbePolicy,
  type ProbePolicy,
  type ProbeRisk,
  type ProbePolicyDecision,
} from "./policy.ts";
import type { CapabilityName } from "../capabilities/vocabulary.ts";

export const DEFAULT_VERIFICATION_TIMEOUT_MS = 5_000;

export interface VerificationRunOptions {
  readonly policy?: ProbePolicy;
  readonly context?: Omit<ProbeContext, "probePolicy" | "probeRisks">;
  readonly risks?: readonly ProbeRisk[];
  readonly risksByCapability?: Readonly<Partial<Record<CapabilityName, readonly ProbeRisk[]>>>;
  readonly now?: () => Date;
}

export interface VerificationRunResult {
  readonly results: readonly VerificationResult[];
  readonly decisions: Readonly<Record<string, ProbePolicyDecision>>;
}

function boundedTimeout(value: number | undefined): number {
  return value === undefined || !Number.isFinite(value) || value <= 0
    ? DEFAULT_VERIFICATION_TIMEOUT_MS
    : Math.floor(value);
}

function timeoutResults(
  capabilities: readonly CapabilityName[],
  now: () => Date,
  message: string,
): readonly VerificationResult[] {
  const completedAt = now().toISOString();
  return capabilities.map((capability) => ({
    schemaVersion: 1 as const,
    capability,
    status: "timed-out" as const,
    startedAt: completedAt,
    completedAt,
    message,
  }));
}

function unavailableResults(
  capabilities: readonly CapabilityName[],
  now: () => Date,
  message: string,
): readonly VerificationResult[] {
  const completedAt = now().toISOString();
  return capabilities.map((capability) => ({
    schemaVersion: 1 as const,
    capability,
    status: "unavailable" as const,
    startedAt: completedAt,
    completedAt,
    message,
  }));
}

async function runBoundedVerification(
  adapter: HarnessVerificationAdapter,
  capabilities: readonly CapabilityName[],
  context: ProbeContext,
  now: () => Date,
): Promise<readonly VerificationResult[]> {
  const controller = new AbortController();
  const parentSignal = context.signal;
  let resolveAborted: ((results: readonly VerificationResult[]) => void) | undefined;
  const aborted = new Promise<readonly VerificationResult[]>((resolve) => {
    resolveAborted = resolve;
  });
  const abortFromParent = () => {
    controller.abort(parentSignal?.reason);
    resolveAborted?.(
      unavailableResults(capabilities, now, "Verification probe was aborted"),
    );
  };
  if (parentSignal?.aborted) {
    abortFromParent();
  } else {
    parentSignal?.addEventListener("abort", abortFromParent, { once: true });
  }

  const timeoutMs = boundedTimeout(context.timeoutMs);
  let timer: NodeJS.Timeout | undefined;
  let timedOut = false;
  try {
    if (parentSignal?.aborted) {
      return unavailableResults(capabilities, now, "Verification probe was aborted");
    }
    const probe = adapter.verify(capabilities, {
      ...context,
      signal: controller.signal,
    });
    const timeout = new Promise<readonly VerificationResult[]>((resolve) => {
      timer = setTimeout(() => {
        timedOut = true;
        controller.abort();
        resolve(
          timeoutResults(
            capabilities,
            now,
            `Verification probe timed out after ${timeoutMs}ms`,
          ),
        );
      }, timeoutMs);
    });
    return await Promise.race([probe, timeout, aborted]);
  } finally {
    if (timer) clearTimeout(timer);
    parentSignal?.removeEventListener("abort", abortFromParent);
    if (timedOut) controller.abort();
  }
}

/**
 * Enforces probe policy before invoking an adapter. Rejected capabilities are
 * represented explicitly and the adapter is never called for them.
 */
export async function verifyCapabilities(
  adapter: HarnessVerificationAdapter,
  capabilities: readonly CapabilityName[],
  options: VerificationRunOptions = {},
): Promise<VerificationRunResult> {
  assertOperationSupported(adapter, "verify");
  const now = options.now ?? (() => new Date());
  const decisions: Record<string, ProbePolicyDecision> = {};
  const allowed: CapabilityName[] = [];
  const rejected: VerificationResult[] = [];
  const allowedRisks = new Set<ProbeRisk>();

  for (const capability of capabilities) {
    const risks = options.risksByCapability?.[capability] ?? options.risks ?? ["read-only"];
    const request = { adapterId: adapter.id, capability, risks };
    const decision = evaluateProbePolicy(request, options.policy);
    decisions[capability] = decision;
    if (decision.allowed) {
      allowed.push(capability);
      for (const risk of decision.risks) allowedRisks.add(risk);
    } else {
      const completedAt = now().toISOString();
      rejected.push({
        schemaVersion: 1,
        capability,
        status: "skipped",
        startedAt: completedAt,
        completedAt,
        message: decision.reason,
      });
    }
  }

  if (allowed.length === 0) return { results: rejected, decisions };
  const context: ProbeContext = {
    ...(options.context ?? {}),
    // The adapter receives the complete risk envelope for the batch. This
    // prevents a mixed batch from being presented as read-only merely because
    // its per-capability risk declarations were supplied via risksByCapability.
    probeRisks: [...allowedRisks],
    probePolicy: options.policy,
  };
  const results = await runBoundedVerification(adapter, allowed, context, now);
  return { results: [...results, ...rejected], decisions };
}
