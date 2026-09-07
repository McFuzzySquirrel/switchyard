import type {
  CapabilityName,
  HarnessProfile,
  TaskRequirements,
} from "../discovery/schema.ts";
import {
  matchRequiredCapabilities,
  rankCapabilityMatches,
  type CapabilityMatch,
  type RankedCapabilityMatch,
} from "./matcher.ts";

/**
 * A routing attempt is a policy decision, not an execution attempt. It records
 * the preferred candidate (when configured) and the qualifying candidate
 * selected by deterministic fallback ranking. Keeping this data pure lets
 * explain and run report the same decision without probing or launching a
 * harness.
 */
export interface RoutingAttempt {
  readonly harnessId: string;
  readonly role: "preferred" | "fallback" | "ranked";
  readonly qualifies: boolean;
  readonly missing: readonly CapabilityName[];
  readonly selected: boolean;
}

export interface RoutingPolicyDecision {
  readonly preferredHarness: string | null;
  readonly allowFallback: boolean;
  readonly preferredAttempt: RoutingAttempt | null;
  readonly attempts: readonly RoutingAttempt[];
  readonly fallbackUsed: boolean;
  readonly selected: RankedCapabilityMatch | undefined;
}

type RoutableHarnessProfile = Pick<HarnessProfile, "id" | "capabilities"> &
  Partial<Pick<HarnessProfile, "status" | "lifecycle">>;

function requirementsFor(
  requirements: TaskRequirements | readonly CapabilityName[],
): readonly CapabilityName[] {
  return "requires" in requirements ? requirements.requires : requirements;
}

function policyFor(
  requirements: TaskRequirements | readonly CapabilityName[],
): Pick<RoutingPolicyDecision, "preferredHarness" | "allowFallback"> {
  if (!("requires" in requirements)) {
    return { preferredHarness: null, allowFallback: false };
  }
  return {
    preferredHarness: requirements.preferredHarness ?? null,
    allowFallback: requirements.allowFallback === true,
  };
}

function attemptFromMatch(
  match: CapabilityMatch,
  role: RoutingAttempt["role"],
  selected: boolean,
): RoutingAttempt {
  return {
    harnessId: match.harnessId,
    role,
    qualifies: match.qualifies,
    missing: [...match.missing],
    selected,
  };
}

/**
 * Applies preferred-harness and fallback policy to pure matcher input.
 *
 * The preferred harness is always checked first when configured. A
 * non-qualifying preferred harness can never be selected. When fallback is
 * not explicitly enabled, the decision is no-match even if another profile
 * qualifies. When fallback is enabled, only a candidate returned by the
 * deterministic all-required ranking may be selected.
 */
export function applyRoutingPolicy(
  profiles: readonly RoutableHarnessProfile[],
  requirements: TaskRequirements | readonly CapabilityName[],
): RoutingPolicyDecision {
  const required = requirementsFor(requirements);
  const { preferredHarness, allowFallback } = policyFor(requirements);
  const ranked = rankCapabilityMatches(profiles, required);

  let preferredAttempt: RoutingAttempt | null = null;
  let preferredMatch: CapabilityMatch | undefined;
  if (preferredHarness !== null) {
    const preferredProfile = profiles.find(
      (profile) => profile.id === preferredHarness,
    );
    preferredMatch = preferredProfile === undefined
      ? {
          harnessId: preferredHarness,
          required: [...required],
          matched: [],
          missing: [...required],
          qualifies: false,
        }
      : matchRequiredCapabilities(preferredProfile, required);
    preferredAttempt = attemptFromMatch(preferredMatch, "preferred", false);
  }

  if (preferredMatch?.qualifies === true && preferredAttempt !== null) {
    const selected = ranked.find(
      (candidate) => candidate.harnessId === preferredHarness,
    );
    if (selected !== undefined) {
      const attempt = { ...preferredAttempt, selected: true };
      return {
        preferredHarness,
        allowFallback,
        preferredAttempt: attempt,
        attempts: [attempt],
        fallbackUsed: false,
        selected,
      };
    }
  }

  if (preferredHarness !== null && !allowFallback) {
    return {
      preferredHarness,
      allowFallback,
      preferredAttempt,
      attempts: preferredAttempt === null ? [] : [preferredAttempt],
      fallbackUsed: false,
      selected: undefined,
    };
  }

  const selected = ranked[0];
  if (selected === undefined) {
    return {
      preferredHarness,
      allowFallback,
      preferredAttempt,
      attempts: preferredAttempt === null ? [] : [preferredAttempt],
      fallbackUsed: false,
      selected: undefined,
    };
  }

  const fallbackAttempt = attemptFromMatch(
    selected,
    preferredHarness === null ? "ranked" : "fallback",
    true,
  );
  const attempts = preferredAttempt === null
    ? [fallbackAttempt]
    : [preferredAttempt, fallbackAttempt];
  return {
    preferredHarness,
    allowFallback,
    preferredAttempt,
    attempts,
    fallbackUsed: preferredHarness !== null,
    selected,
  };
}

/** Compatibility-friendly alias for callers that prefer a decision verb. */
export const resolveRoutingPolicy = applyRoutingPolicy;
