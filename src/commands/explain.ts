import {
  capabilityRankingInputs,
  matchRequiredCapabilities,
  rankCapabilityMatches,
  type CapabilityRankingInputs,
} from "../capabilities/matcher.ts";
import {
  markStaleEntries,
  readRegistry,
  type RegistryPath,
} from "../discovery/registry.ts";
import {
  assertTaskRequirements,
  type CapabilityName,
  type HarnessProfile,
  type SchemaIssue,
  type TaskRequirements,
} from "../discovery/schema.ts";
import { redactSecrets } from "../discovery/probe.ts";
import { resolveRegistryPath } from "../config/registry.ts";
import {
  DECISION_SCHEMA_VERSION,
  type DecisionJsonEnvelope,
  type DecisionStatus,
} from "../output/decision.ts";
import { serializeCommandJson } from "../output/json.ts";

export type ExplainCommandStatus = Exclude<DecisionStatus, "invalid-input">;

export interface ExplainVerificationInput {
  readonly capability: CapabilityName;
  readonly discoveryStatus: HarnessProfile["capabilities"][number]["discovery"]["status"] | "missing";
  readonly verificationStatus: HarnessProfile["capabilities"][number]["verification"]["status"] | "missing";
  readonly countedAsVerified: boolean;
}

export interface ExplainCandidate {
  readonly harnessId: string;
  readonly displayName: string;
  readonly status: HarnessProfile["status"];
  readonly lifecycle: HarnessProfile["lifecycle"];
  readonly required: readonly CapabilityName[];
  readonly matched: readonly CapabilityName[];
  readonly missing: readonly CapabilityName[];
  readonly qualifies: boolean;
  readonly verification: readonly ExplainVerificationInput[];
  readonly verificationTier: CapabilityRankingInputs["verificationTier"];
  readonly rankingKey: CapabilityRankingInputs["rankingKey"];
  readonly ranking: CapabilityRankingInputs;
}

export interface ExplainSelection {
  readonly harnessId: string;
  readonly reason: string;
}

export interface ExplainPolicy {
  readonly preferredHarness: string | null;
  readonly allowFallback: boolean;
  readonly preferredAttempt: {
    readonly harnessId: string;
    readonly qualifies: boolean;
    readonly missing: readonly CapabilityName[];
  } | null;
  readonly fallbackUsed: boolean;
}

export interface ExplainCommandResult extends DecisionJsonEnvelope {
  readonly status: ExplainCommandStatus;
  readonly registryPath: string;
  readonly requirements: TaskRequirements;
  readonly rankingPolicy: {
    readonly requiredCapabilities: "all";
    readonly verificationOrder: readonly ["verified", "discovered"];
    readonly tieBreaker: "harness-id-ascending";
  };
  readonly policy: ExplainPolicy;
  readonly candidates: readonly ExplainCandidate[];
  readonly selectedHarness: string | null;
  readonly selection: ExplainSelection | null;
  readonly reason: string;
}

export interface ExplainInvalidInputResult extends DecisionJsonEnvelope {
  readonly status: "invalid-input";
  readonly error: {
    readonly code: "invalid-input";
    readonly message: string;
    readonly issues: readonly SchemaIssue[];
  };
}

export class ExplainInputError extends Error {
  readonly issues: readonly SchemaIssue[];

  constructor(issues: readonly SchemaIssue[]) {
    super(
      `Invalid explain requirements: ${issues
        .map((issue) => `${issue.path} ${issue.message}`)
        .join("; ")}`,
    );
    this.name = "ExplainInputError";
    this.issues = issues;
  }
}

export interface ExplainCommandOptions {
  readonly registryPath?: RegistryPath;
  readonly requirements: unknown;
  readonly staleAfterMs?: number;
  readonly now?: () => Date;
  readonly env?: Readonly<Record<string, string | undefined>>;
}

function verifiedStatus(
  observation: HarnessProfile["capabilities"][number] | undefined,
  profile: HarnessProfile,
): ExplainVerificationInput["countedAsVerified"] {
  return profile.status !== "stale" &&
    profile.lifecycle !== "discovered" &&
    observation?.discovery.status === "observed" &&
    observation.verification.status === "passed";
}

function candidateFor(
  profile: HarnessProfile,
  requirements: TaskRequirements,
): ExplainCandidate {
  const match = matchRequiredCapabilities(profile, requirements);
  const ranking = capabilityRankingInputs(profile, requirements);
  const verification = requirements.requires.map((capability) => {
    const observation = profile.capabilities.find(
      (candidate) => candidate.capability === capability,
    );
    const input: ExplainVerificationInput = {
      capability,
      discoveryStatus: observation?.discovery.status ?? "missing",
      verificationStatus: observation?.verification.status ?? "missing",
      countedAsVerified: verifiedStatus(observation, profile),
    };
    return input;
  });

  return {
    harnessId: profile.id,
    displayName: redactSecrets(profile.displayName),
    status: profile.status,
    lifecycle: profile.lifecycle,
    required: match.required,
    matched: match.matched,
    missing: match.missing,
    qualifies: match.qualifies,
    verification,
    verificationTier: ranking.verificationTier,
    rankingKey: ranking.rankingKey,
    ranking,
  };
}

function selectionReason(
  selected: ExplainCandidate,
  preferredHarness: string | undefined,
  fallbackUsed: boolean,
): string {
  if (preferredHarness !== undefined && selected.harnessId === preferredHarness) {
    return `Preferred harness '${preferredHarness}' qualifies; selected by explicit preference.`;
  }
  if (fallbackUsed && preferredHarness !== undefined) {
    return `Preferred harness '${preferredHarness}' did not qualify; selected '${selected.harnessId}' using deterministic fallback ranking.`;
  }
  return `Selected '${selected.harnessId}' as the highest-ranked qualifying candidate using verification tier and ascending harness ID.`;
}

function noMatchReason(
  requirements: TaskRequirements,
  preferredHarness: string | undefined,
  allowFallback: boolean,
  candidates: readonly ExplainCandidate[],
): string {
  if (preferredHarness !== undefined && !allowFallback) {
    const preferred = candidates.find((candidate) => candidate.harnessId === preferredHarness);
    return preferred === undefined
      ? `Preferred harness '${preferredHarness}' is not a qualifying candidate; fallback is disabled.`
      : `Preferred harness '${preferredHarness}' is missing required capabilities (${preferred.missing.join(", ")}); fallback is disabled.`;
  }
  return requirements.requires.length === 0
    ? "At least one required capability must be supplied."
    : "No harness satisfies every required capability.";
}

function normalizeRequirements(input: unknown): TaskRequirements {
  const result = assertTaskRequirements(input);
  if (result.requires.length === 0) {
    throw new ExplainInputError([
      {
        path: "$.requires",
        message: "must contain at least one capability for explain",
      },
    ]);
  }
  // Explain output always carries the version, even when callers use the
  // backwards-compatible unversioned TaskRequirements input.
  return {
    schemaVersion: 1,
    requires: [...result.requires],
    ...(result.preferredHarness === undefined
      ? {}
      : { preferredHarness: result.preferredHarness }),
    ...(result.allowFallback === undefined
      ? {}
      : { allowFallback: result.allowFallback }),
  };
}

/**
 * Reads the cached registry and explains a pure routing decision. It never
 * probes, launches a harness, or writes the registry.
 */
export async function explain(
  options: ExplainCommandOptions,
): Promise<ExplainCommandResult> {
  let requirements: TaskRequirements;
  try {
    requirements = normalizeRequirements(options.requirements);
  } catch (error: unknown) {
    if (error instanceof ExplainInputError) {
      throw error;
    }
    if (error instanceof Error && "issues" in error && Array.isArray(error.issues)) {
      throw new ExplainInputError(error.issues as readonly SchemaIssue[]);
    }
    throw error;
  }

  const registryPath = resolveRegistryPath(options.registryPath, { env: options.env });
  const cached = await readRegistry(registryPath);
  const registry = cached === undefined
    ? undefined
    : markStaleEntries(cached, {
        staleAfterMs: options.staleAfterMs,
        now: options.now,
      });
  const profiles = [...(registry?.harnesses ?? [])].sort((left, right) =>
    left.id < right.id ? -1 : left.id > right.id ? 1 : 0);
  const candidates = profiles.map((profile) => candidateFor(profile, requirements));
  const ranked = rankCapabilityMatches(profiles, requirements);
  const qualifyingById = new Map(ranked.map((candidate) => [candidate.harnessId, candidate]));
  const preferredHarness = requirements.preferredHarness;
  const allowFallback = requirements.allowFallback === true;
  const preferred = preferredHarness === undefined
    ? undefined
    : candidates.find((candidate) => candidate.harnessId === preferredHarness);
  const preferredAttempt = preferredHarness === undefined
    ? null
    : {
        harnessId: preferredHarness,
        qualifies: preferred?.qualifies ?? false,
        missing: preferred?.missing ?? requirements.requires,
      };

  let selected: ExplainCandidate | undefined;
  let fallbackUsed = false;
  if (preferredHarness !== undefined && preferred?.qualifies === true) {
    selected = preferred;
  } else if (preferredHarness === undefined || allowFallback) {
    const rankedSelection = ranked[0];
    selected = rankedSelection === undefined
      ? undefined
      : candidates.find((candidate) => candidate.harnessId === rankedSelection.harnessId);
    fallbackUsed = preferredHarness !== undefined && selected !== undefined;
  }

  const reason = selected === undefined
    ? noMatchReason(requirements, preferredHarness, allowFallback, candidates)
    : selectionReason(selected, preferredHarness, fallbackUsed);
  const selection = selected === undefined
    ? null
    : { harnessId: selected.harnessId, reason };

  // Keep the map alive as an explicit assertion that selection only comes
  // from the matcher output, while candidate details remain complete for all
  // profiles (including non-qualifying ones).
  if (selected !== undefined && !qualifyingById.has(selected.harnessId)) {
    throw new Error("Explain selection was not produced by the capability matcher");
  }

  return {
    schemaVersion: DECISION_SCHEMA_VERSION,
    command: "explain",
    status: selected === undefined ? "no-match" : "success",
    registryPath,
    requirements,
    rankingPolicy: {
      requiredCapabilities: "all",
      verificationOrder: ["verified", "discovered"],
      tieBreaker: "harness-id-ascending",
    },
    policy: {
      preferredHarness: preferredHarness ?? null,
      allowFallback,
      preferredAttempt,
      fallbackUsed,
    },
    candidates,
    selectedHarness: selected?.harnessId ?? null,
    selection,
    reason,
  };
}

export const explainCommand = explain;
export const runExplainCommand = explain;

export function formatExplainJson(
  result: ExplainCommandResult | ExplainInvalidInputResult,
): string {
  return serializeCommandJson(result);
}

export function formatExplainHuman(
  result: ExplainCommandResult | ExplainInvalidInputResult,
): string {
  if (result.status === "invalid-input") {
    return [
      "Switchyard explain",
      "Status: invalid-input",
      `Error: ${result.error.message}`,
    ].join("\n");
  }

  const lines = [
    "Switchyard explain",
    `Registry: ${result.registryPath}`,
    `Status: ${result.status}`,
    `Requirements: ${result.requirements.requires.join(", ")}`,
    `Policy: preferred=${result.policy.preferredHarness ?? "none"}; fallback=${result.policy.allowFallback ? "enabled" : "disabled"}; fallback-used=${result.policy.fallbackUsed ? "yes" : "no"}`,
    `Preferred attempt: ${result.policy.preferredAttempt === null
      ? "none"
      : `${result.policy.preferredAttempt.harnessId} [qualifies: ${result.policy.preferredAttempt.qualifies ? "yes" : "no"}; missing: ${result.policy.preferredAttempt.missing.join(", ") || "none"}]`}`,
    "Candidates:",
  ];
  for (const candidate of result.candidates) {
    lines.push(
      `- ${candidate.displayName} (${candidate.harnessId}): ${candidate.qualifies ? "qualifies" : "does not qualify"} [status: ${candidate.status}; lifecycle: ${candidate.lifecycle}]`,
      `  matched: ${candidate.matched.length > 0 ? candidate.matched.join(", ") : "none"}`,
      `  missing: ${candidate.missing.length > 0 ? candidate.missing.join(", ") : "none"}`,
      `  verification: ${candidate.verification
        .map((item) => `${item.capability} [discovery: ${item.discoveryStatus}; verification: ${item.verificationStatus}; counted: ${item.countedAsVerified ? "yes" : "no"}]`)
        .join("; ") || "none"}`,
      `  ranking: tier=${candidate.ranking.verificationTier}; key=${candidate.ranking.rankingKey.join(",")}; verified=${candidate.ranking.verifiedRequired.length}/${candidate.ranking.requiredCount}`,
    );
  }
  lines.push(
    `Selection: ${result.selectedHarness ?? "none"}`,
    `Reason: ${result.reason}`,
  );
  return lines.join("\n");
}

export function explainInvalidInput(
  error: ExplainInputError,
): ExplainInvalidInputResult {
  return {
    schemaVersion: DECISION_SCHEMA_VERSION,
    command: "explain",
    status: "invalid-input",
    error: {
      code: "invalid-input",
      message: redactSecrets(error.message),
      issues: error.issues,
    },
  };
}
