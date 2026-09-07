import { boundExcerpt, redactSecrets } from "../discovery/probe.ts";

/** Risk classes a verification probe may declare before it is launched. */
export type ProbeRisk =
  | "read-only"
  | "mutating"
  | "external-access"
  | "paid"
  | "model-invoking";

export interface ProbePolicy {
  /** Read-only probes are always permitted unless explicitly disabled. */
  readonly allowReadOnly?: boolean;
  /** Explicit approval for any probe that can change state. */
  readonly allowMutatingProbes?: boolean;
  /** Explicit approval for network/service access. */
  readonly allowExternalAccess?: boolean;
  /** Explicit approval for probes that can incur provider charges. */
  readonly allowPaidProbes?: boolean;
  /** Explicit approval for probes that invoke a model. */
  readonly allowModelInvocation?: boolean;
}

export interface ProbeRequest {
  readonly adapterId: string;
  readonly capability: string;
  readonly risks?: readonly ProbeRisk[];
  /** Human-readable description only; never include arguments or prompt text. */
  readonly description?: string;
}

export interface ProbePolicyDecision {
  readonly allowed: boolean;
  readonly risks: readonly ProbeRisk[];
  readonly warnings: readonly string[];
  readonly reason?: string;
}

const RISK_APPROVAL: Readonly<Record<Exclude<ProbeRisk, "read-only">, keyof ProbePolicy>> = {
  mutating: "allowMutatingProbes",
  "external-access": "allowExternalAccess",
  paid: "allowPaidProbes",
  "model-invoking": "allowModelInvocation",
};

function uniqueRisks(risks: readonly ProbeRisk[] | undefined): readonly ProbeRisk[] {
  const values = risks?.length ? risks : ["read-only" as const];
  return [...new Set(values)];
}

function warning(risk: ProbeRisk): string {
  switch (risk) {
    case "mutating":
      return "Probe may mutate local or remote state.";
    case "external-access":
      return "Probe may access an external service or network.";
    case "paid":
      return "Probe may incur provider or usage charges.";
    case "model-invoking":
      return "Probe invokes a model and may send prompt or repository context.";
    default:
      return "Probe is read-only and bounded.";
  }
}

/** Evaluates policy without launching an adapter or exposing probe payloads. */
export function evaluateProbePolicy(
  request: ProbeRequest,
  policy: ProbePolicy = {},
): ProbePolicyDecision {
  const risks = uniqueRisks(request.risks);
  const warnings = risks.filter((risk) => risk !== "read-only").map(warning);
  if (risks.includes("read-only") && policy.allowReadOnly === false) {
    return { allowed: false, risks, warnings, reason: "Read-only probes are disabled by policy." };
  }
  const denied = risks.find(
    (risk): risk is Exclude<ProbeRisk, "read-only"> =>
      risk !== "read-only" && policy[RISK_APPROVAL[risk]] !== true,
  );
  if (denied !== undefined) {
    return {
      allowed: false,
      risks,
      warnings,
      reason: `Probe requires explicit approval for ${denied}.`,
    };
  }
  return { allowed: true, risks, warnings };
}

export class ProbePolicyError extends Error {
  readonly decision: ProbePolicyDecision;
  readonly adapterId: string;
  readonly capability: string;

  constructor(request: ProbeRequest, decision: ProbePolicyDecision) {
    super(`Probe for ${request.adapterId}/${request.capability} was rejected by policy: ${decision.reason}`);
    this.name = "ProbePolicyError";
    this.decision = decision;
    this.adapterId = request.adapterId;
    this.capability = request.capability;
  }
}

export function assertProbeAllowed(
  request: ProbeRequest,
  policy: ProbePolicy = {},
): ProbePolicyDecision {
  const decision = evaluateProbePolicy(request, policy);
  if (!decision.allowed) throw new ProbePolicyError(request, decision);
  return decision;
}

/** Safe diagnostic text for policy warnings; payloads are intentionally omitted. */
export function formatProbeWarnings(
  decision: ProbePolicyDecision,
  maxLength = 1024,
): string {
  const text = decision.warnings.join(" ");
  return boundExcerpt(redactSecrets(text), maxLength);
}
