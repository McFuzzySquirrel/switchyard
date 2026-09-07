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
