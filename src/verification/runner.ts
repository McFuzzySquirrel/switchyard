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
      rejected.push({
        capability,
        status: "skipped",
        completedAt: now().toISOString(),
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
  const results = await adapter.verify(allowed, context);
  return { results: [...results, ...rejected], decisions };
}
