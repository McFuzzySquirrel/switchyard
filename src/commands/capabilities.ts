import {
  markStaleEntries,
  readRegistry,
  type RegistryPath,
} from "../discovery/registry.ts";
import type {
  CapabilityObservation,
  HarnessProfile,
  LocalRegistry,
} from "../discovery/schema.ts";
import { redactSecrets } from "../discovery/probe.ts";
import {
  COMMAND_SCHEMA_VERSION,
  type DiscoveryCommandStatus,
} from "./discover.ts";
import { serializeCommandJson } from "../output/json.ts";
import { resolveRegistryPath } from "../config/registry.ts";

export interface CapabilitiesCommandOptions {
  readonly registryPath?: RegistryPath;
  readonly verified?: boolean;
  readonly staleAfterMs?: number;
  readonly now?: () => Date;
  readonly env?: Readonly<Record<string, string | undefined>>;
}

export interface CapabilitiesCommandResult {
  readonly schemaVersion: typeof COMMAND_SCHEMA_VERSION;
  readonly command: "capabilities";
  readonly status: DiscoveryCommandStatus;
  readonly registryPath: string;
  readonly verifiedOnly: boolean;
  readonly harnesses: readonly HarnessProfile[];
  readonly stale: readonly string[];
}

function presentationProfile(
  profile: HarnessProfile,
  verifiedOnly: boolean,
): HarnessProfile | undefined {
  const capabilities = profile.capabilities.filter((observation) =>
    !verifiedOnly || observation.verification.status === "passed");
  if (verifiedOnly && capabilities.length === 0) return undefined;

  return {
    ...profile,
    capabilities: capabilities.map((observation: CapabilityObservation) => ({
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
    availability: {
      ...profile.availability,
      ...(profile.availability.reason === undefined
        ? {}
        : { reason: redactSecrets(profile.availability.reason) }),
    },
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

export async function capabilities(
  options: CapabilitiesCommandOptions = {},
): Promise<CapabilitiesCommandResult> {
  const registryPath = resolveRegistryPath(
    options.registryPath,
    { env: options.env },
  );
  const cached = await readRegistry(registryPath);
  const registry: LocalRegistry | undefined = cached === undefined
    ? undefined
    : markStaleEntries(cached, {
        staleAfterMs: options.staleAfterMs,
        now: options.now,
      });
  const verifiedOnly = options.verified === true;
  const harnesses = (registry?.harnesses ?? [])
    .map((profile) => presentationProfile(profile, verifiedOnly))
    .filter((profile): profile is HarnessProfile => profile !== undefined);
  const stale = (registry?.harnesses ?? [])
    .filter((profile) => profile.status === "stale")
    .map((profile) => profile.id);

  return {
    schemaVersion: COMMAND_SCHEMA_VERSION,
    command: "capabilities",
    status: harnesses.length === 0 ? "empty" : "success",
    registryPath,
    verifiedOnly,
    harnesses,
    stale,
  };
}

export const inspectCapabilities = capabilities;
export const capabilitiesCommand = capabilities;
export const runCapabilitiesCommand = capabilities;

export function formatCapabilitiesJson(result: CapabilitiesCommandResult): string {
  return serializeCommandJson(result);
}

export function formatCapabilitiesHuman(result: CapabilitiesCommandResult): string {
  const lines = [
    "Switchyard capabilities",
    `Registry: ${result.registryPath}`,
    `Status: ${result.status}`,
    `Filter: ${result.verifiedOnly ? "verified only" : "discovered and verified"}`,
  ];
  for (const profile of result.harnesses) {
    lines.push(`- ${profile.displayName} (${profile.id}): ${profile.status}`);
    const capabilities = profile.capabilities.map((observation) => {
      const verification = observation.verification.status;
      return `${observation.capability} [discovery: ${observation.discovery.status}; verification: ${verification}]`;
    });
    lines.push(`  ${capabilities.length > 0 ? capabilities.join("\n  ") : "capabilities: none"}`);
  }
  if (result.harnesses.length === 0) {
    lines.push("- no matching capabilities are recorded");
  }
  if (result.stale.length > 0) {
    lines.push(`Stale: ${result.stale.join(", ")}`);
  }
  return lines.join("\n");
}
