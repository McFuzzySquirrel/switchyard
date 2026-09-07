import {
  BUILT_IN_DISCOVERY_ADAPTERS,
  type HarnessDiscoveryAdapter,
  type HarnessDiscoveryOptions,
} from "../harness/index.ts";
import {
  markStaleEntries,
  readRegistry,
  refreshRegistry,
  writeRegistry,
  type RegistryPath,
  type RegistryRefreshFailure,
} from "../discovery/registry.ts";
import type {
  HarnessProfile,
  LocalRegistry,
} from "../discovery/schema.ts";
import { resolveRegistryPath } from "../config/registry.ts";
import { redactSecrets } from "../discovery/probe.ts";

export const COMMAND_SCHEMA_VERSION = 1 as const;

export type DiscoveryCommandStatus = "success" | "partial" | "empty";

export interface DiscoverCommandOptions extends HarnessDiscoveryOptions {
  readonly registryPath?: RegistryPath;
  readonly adapters?: readonly HarnessDiscoveryAdapter[];
  /** Probe the adapters even when a cached registry exists. */
  readonly refresh?: boolean;
  readonly staleAfterMs?: number;
  readonly harnessId?: string;
}

export interface DiscoverCommandResult {
  readonly schemaVersion: typeof COMMAND_SCHEMA_VERSION;
  readonly command: "discover";
  readonly status: DiscoveryCommandStatus;
  readonly registryPath: string;
  readonly harnesses: readonly HarnessProfile[];
  readonly refreshed: readonly string[];
  readonly stale: readonly string[];
  readonly failures: readonly RegistryRefreshFailure[];
}

function presentationProfile(profile: HarnessProfile): HarnessProfile {
  return {
    ...profile,
    availability: {
      ...profile.availability,
      ...(profile.availability.reason === undefined
        ? {}
        : { reason: redactSecrets(profile.availability.reason) }),
    },
    capabilities: profile.capabilities.map((observation) => ({
      ...observation,
      discovery: {
        ...observation.discovery,
        ...(observation.discovery.evidence === undefined
          ? {}
          : {
              evidence: {
                ...observation.discovery.evidence,
                excerpt: redactSecrets(observation.discovery.evidence.excerpt),
              },
            }),
      },
      verification: {
        ...observation.verification,
        ...(observation.verification.evidence === undefined
          ? {}
          : {
              evidence: {
                ...observation.verification.evidence,
                excerpt: redactSecrets(observation.verification.evidence.excerpt),
              },
            }),
      },
    })),
    ...(profile.diagnostics === undefined
      ? {}
      : {
          diagnostics: profile.diagnostics.map((diagnostic) => ({
            ...diagnostic,
            message: redactSecrets(diagnostic.message),
          })),
        }),
  };
}

function commandStatus(
  harnesses: readonly HarnessProfile[],
  failures: readonly RegistryRefreshFailure[],
): DiscoveryCommandStatus {
  if (harnesses.length === 0) return "empty";
  return failures.length > 0 ||
    harnesses.some((profile) => profile.status !== "available")
    ? "partial"
    : "success";
}

function staleIds(registry: LocalRegistry): readonly string[] {
  return registry.harnesses
    .filter((profile) => profile.status === "stale")
    .map((profile) => profile.id);
}

function presentationFailures(
  failures: readonly RegistryRefreshFailure[],
): readonly RegistryRefreshFailure[] {
  return failures.map((failure) => ({
    harnessId: failure.harnessId,
    message: redactSecrets(failure.message),
  }));
}

/**
 * Discovers configured built-in (or supplied) adapters and persists the
 * resulting local snapshot. A cached snapshot is used unless `refresh` is
 * requested; a missing snapshot always triggers the initial discovery.
 */
export async function discover(
  options: DiscoverCommandOptions = {},
): Promise<DiscoverCommandResult> {
  const registryPath = resolveRegistryPath(
    options.registryPath,
    { env: options.env },
  );
  const adapters = options.adapters ?? BUILT_IN_DISCOVERY_ADAPTERS;
  const cached = await readRegistry(registryPath);

  let registry: LocalRegistry;
  let refreshed: readonly string[] = [];
  let failures: readonly RegistryRefreshFailure[] = [];

  if (cached === undefined || options.refresh === true) {
    const refreshedResult = await refreshRegistry(registryPath, adapters, {
      ...options,
      ...(options.harnessId === undefined ? {} : { harnessId: options.harnessId }),
    });
    registry = refreshedResult.registry;
    refreshed = refreshedResult.refreshed;
    failures = refreshedResult.failures;
  } else {
    const marked = markStaleEntries(cached, {
      staleAfterMs: options.staleAfterMs,
      now: options.now,
    });
    if (marked !== cached) {
      await writeRegistry(registryPath, marked);
    }
    registry = marked;
  }

  const harnesses = registry.harnesses.map(presentationProfile);
  const safeFailures = presentationFailures(failures);
  return {
    schemaVersion: COMMAND_SCHEMA_VERSION,
    command: "discover",
    status: commandStatus(harnesses, safeFailures),
    registryPath,
    harnesses,
    refreshed,
    stale: staleIds(registry),
    failures: safeFailures,
  };
}

export const discoverHarnesses = discover;
export const discoverCommand = discover;
export const runDiscoverCommand = discover;

export function formatDiscoverHuman(result: DiscoverCommandResult): string {
  const lines = [
    "Switchyard discovery",
    `Registry: ${result.registryPath}`,
    `Status: ${result.status}`,
    `Refreshed: ${result.refreshed.length > 0 ? result.refreshed.join(", ") : "none"}`,
  ];

  for (const profile of result.harnesses) {
    const version = profile.version === undefined ? "" : `, version ${profile.version}`;
    lines.push(`- ${profile.displayName} (${profile.id}): ${profile.status}${version}`);
    lines.push(`  executable: ${profile.executable} [${profile.executableSource}]`);
    const capabilities = profile.capabilities.map((observation) =>
      `${observation.capability} (${observation.discovery.status})`);
    lines.push(`  capabilities: ${capabilities.length > 0 ? capabilities.join(", ") : "none"}`);
    for (const diagnostic of profile.diagnostics ?? []) {
      lines.push(`  diagnostic [${diagnostic.code}]: ${diagnostic.message}`);
    }
  }
  if (result.harnesses.length === 0) {
    lines.push("- no harness profiles are available");
  }
  for (const failure of result.failures) {
    lines.push(`- adapter failure [${failure.harnessId}]: ${failure.message}`);
  }
  if (result.stale.length > 0) {
    lines.push(`Stale: ${result.stale.join(", ")}`);
  }
  return lines.join("\n");
}
