import type {
  CapabilityName,
  CapabilityObservation,
  HarnessProfile,
  TaskRequirements,
} from "../discovery/schema.ts";

/**
 * The result of comparing one profile with a set of task requirements.
 *
 * `matched` and `missing` retain the order in which capabilities were
 * declared by the task, making explanations stable across runs.
 */
export interface CapabilityMatch {
  readonly harnessId: string;
  readonly required: readonly CapabilityName[];
  readonly matched: readonly CapabilityName[];
  readonly missing: readonly CapabilityName[];
  readonly qualifies: boolean;
}

export type CapabilityVerificationTier = "verified" | "discovered";

/**
 * A capability match with the inputs used by the deterministic ranking policy.
 *
 * The ranking key is intentionally public and explicit: callers can include it
 * in explanations without having to reproduce an implementation detail.
 */
export interface RankedCapabilityMatch extends CapabilityMatch {
  readonly verificationTier: CapabilityVerificationTier;
  readonly rankingKey: readonly [number, string];
}

type RoutableHarnessProfile = Pick<HarnessProfile, "id" | "capabilities"> &
  Partial<Pick<HarnessProfile, "status" | "lifecycle">>;

function requiredCapabilities(
  requirements: TaskRequirements | readonly CapabilityName[],
): readonly CapabilityName[] {
  return "requires" in requirements ? requirements.requires : requirements;
}

function discoveredCapabilities(
  observations: readonly CapabilityObservation[],
): ReadonlySet<CapabilityName> {
  return new Set(
    observations
      .filter((observation) => observation.discovery.status === "observed")
      .map((observation) => observation.capability),
  );
}

function verifiedCapabilities(
  observations: readonly CapabilityObservation[],
): ReadonlySet<CapabilityName> {
  return new Set(
    observations
      .filter(
        (observation) =>
          observation.discovery.status === "observed" &&
          observation.verification?.status === "passed",
      )
      .map((observation) => observation.capability),
  );
}

function compareStableIds(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

/**
 * Matches all required capabilities against a harness profile.
 *
 * A capability is a match only when discovery positively observed it.
 * Verification state is intentionally not used here; verification-aware
 * ranking is a later routing concern and must not make this predicate
 * accidentally claim that an unverified capability is verified.
 */
export function matchRequiredCapabilities(
  profile: Pick<HarnessProfile, "id" | "capabilities">,
  requirements: TaskRequirements | readonly CapabilityName[],
): CapabilityMatch {
  const required = requiredCapabilities(requirements);
  const discovered = discoveredCapabilities(profile.capabilities);
  const matched = required.filter((capability) => discovered.has(capability));
  const missing = required.filter((capability) => !discovered.has(capability));

  return {
    harnessId: profile.id,
    required: [...required],
    matched,
    missing,
    qualifies: missing.length === 0,
  };
}

/** Boolean convenience predicate for callers that do not need diagnostics. */
export function matchesRequiredCapabilities(
  profile: Pick<HarnessProfile, "id" | "capabilities">,
  requirements: TaskRequirements | readonly CapabilityName[],
): boolean {
  return matchRequiredCapabilities(profile, requirements).qualifies;
}

/** Alias using the shorter vocabulary used by routing callers. */
export const matchCapabilities = matchRequiredCapabilities;
export const matchesCapabilities = matchesRequiredCapabilities;

/**
 * Rank profiles without depending on their input order.
 *
 * Only profiles that positively match every requirement are returned. A full
 * match whose required capabilities are all verified outranks a full match
 * supported only by discovery. Equal-tier matches are ordered by harness id,
 * the registry's stable identity key. No profile is selected here and no
 * registry or probe state is changed.
 */
export function rankCapabilityMatches(
  profiles: readonly RoutableHarnessProfile[],
  requirements: TaskRequirements | readonly CapabilityName[],
): readonly RankedCapabilityMatch[] {
  const required = requiredCapabilities(requirements);
  return profiles
    .map((profile): RankedCapabilityMatch => {
      const match = matchRequiredCapabilities(profile, required);
      const verified = verifiedCapabilities(profile.capabilities);
      const fullyVerified =
        required.length > 0 &&
        profile.status !== "stale" &&
        profile.lifecycle !== "discovered" &&
        required.every((capability) => verified.has(capability));
      const tier = fullyVerified ? 1 : 0;
      return {
        ...match,
        verificationTier: fullyVerified ? "verified" : "discovered",
        rankingKey: [tier, profile.id],
      };
    })
    .filter((candidate) => candidate.qualifies)
    .sort(
      (left, right) =>
        right.rankingKey[0] - left.rankingKey[0] ||
          compareStableIds(left.rankingKey[1], right.rankingKey[1]),
    );
}

/** Select the first qualifying candidate under the deterministic policy. */
export function selectBestCapabilityMatch(
  profiles: readonly RoutableHarnessProfile[],
  requirements: TaskRequirements | readonly CapabilityName[],
): RankedCapabilityMatch | undefined {
  return rankCapabilityMatches(profiles, requirements)[0];
}

/** Compatibility-friendly aliases for routing callers. */
export const rankCandidates = rankCapabilityMatches;
export const selectCandidate = selectBestCapabilityMatch;
