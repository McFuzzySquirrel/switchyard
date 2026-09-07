import {
  createBuiltInHarnessAdapterRegistry,
  HarnessAdapterRegistry,
  type HarnessAdapter,
} from "../harness/index.ts";
import {
  assertHarnessProfile,
  type CapabilityName,
  type HarnessProfile,
  type RegistryPath,
  type VerificationStatus,
} from "../discovery/index.ts";
import {
  markStaleEntries,
  readRegistry,
  writeRegistry,
} from "../discovery/registry.ts";
import { boundExcerpt, redactSecrets } from "../discovery/probe.ts";
import {
  loadSwitchyardConfig,
  resolveEffectiveRegistryPath,
  resolveHarnessRuntimeConfig,
  type SwitchyardConfig,
} from "../config/index.ts";
import {
  verifyCapabilities,
  type VerificationRunResult,
  type VerificationRunOptions,
} from "../verification/index.ts";
import type { ProbePolicy, ProbeRisk } from "../verification/policy.ts";
import { COMMAND_SCHEMA_VERSION, serializeCommandJson } from "../output/json.ts";

export type VerifyCommandStatus = "success" | "partial" | "empty";

export interface VerifyWarning {
  readonly harnessId: string;
  readonly capability: CapabilityName;
  readonly risks: readonly Exclude<ProbeRisk, "read-only">[];
  readonly messages: readonly string[];
}

export interface VerifyRecord {
  readonly harnessId: string;
  readonly capability: CapabilityName;
  readonly status: VerificationStatus;
  readonly startedAt: string;
  readonly completedAt: string;
  readonly message?: string;
}

export interface VerifyCommandResult {
  readonly schemaVersion: typeof COMMAND_SCHEMA_VERSION;
  readonly command: "verify";
  readonly status: VerifyCommandStatus;
  readonly registryPath: string;
  readonly harnesses: readonly string[];
  readonly capabilities: readonly CapabilityName[];
  /** Fixed, payload-free warnings for risky probes. */
  readonly warnings: readonly VerifyWarning[];
  readonly verifications: readonly VerifyRecord[];
}

export interface VerifyCommandOptions {
  readonly registryPath?: RegistryPath;
  readonly configPath?: string | URL;
  readonly config?: SwitchyardConfig;
  readonly harnessId?: string;
  readonly capabilities?: readonly CapabilityName[];
  readonly risks?: readonly ProbeRisk[];
  readonly risksByCapability?: Readonly<Partial<Record<CapabilityName, readonly ProbeRisk[]>>>;
  readonly policy?: ProbePolicy;
  readonly staleAfterMs?: number;
  readonly now?: () => Date;
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly adapters?: HarnessAdapterRegistry | readonly HarnessAdapter[];
}

function toRegistry(
  adapters: HarnessAdapterRegistry | readonly HarnessAdapter[] | undefined,
): HarnessAdapterRegistry {
  if (adapters === undefined) return createBuiltInHarnessAdapterRegistry();
  if (adapters instanceof HarnessAdapterRegistry) return adapters;
  return new HarnessAdapterRegistry(adapters);
}

function policyFor(
  harnessId: string,
  config: SwitchyardConfig,
  options: VerifyCommandOptions,
): ProbePolicy {
  const runtime = resolveHarnessRuntimeConfig(harnessId, config, {}, options.env);
  return {
    ...(options.policy ?? {}),
    allowMutatingProbes: options.policy?.allowMutatingProbes ?? runtime.allowMutatingProbes,
    allowExternalAccess: options.policy?.allowExternalAccess ?? runtime.allowExternalAccess,
    allowPaidProbes: options.policy?.allowPaidProbes ?? runtime.allowPaidProbes,
    allowModelInvocation: options.policy?.allowModelInvocation ?? runtime.allowModelInvocation,
  };
}

function profileCapabilities(
  profile: HarnessProfile,
  requested: readonly CapabilityName[] | undefined,
): readonly CapabilityName[] {
  if (requested !== undefined) return requested;
  return profile.capabilities
    .filter((observation) => observation.discovery.status === "observed")
    .map((observation) => observation.capability);
}

function unsupportedResults(
  capabilities: readonly CapabilityName[],
  now: () => Date,
  message: string,
): VerificationRunResult {
  const timestamp = now().toISOString();
  return {
    results: capabilities.map((capability) => ({
      schemaVersion: 1,
      capability,
      status: "unavailable" as const,
      startedAt: timestamp,
      completedAt: timestamp,
      message,
    })),
    decisions: {},
    warnings: [],
  };
}

function updateProfile(
  profile: HarnessProfile,
  run: VerificationRunResult,
  now: () => Date,
): HarnessProfile {
  const byCapability = new Map(run.results.map((result) => [result.capability, result]));
  const capabilities = profile.capabilities.map((observation) => {
    const result = byCapability.get(observation.capability);
    if (result === undefined) return observation;
    const message = result.message === undefined
      ? undefined
      : boundExcerpt(redactSecrets(result.message));
    const evidenceExcerpt = message ?? (
      result.status === "passed" ? "Verification probe passed." : undefined
    );
    return {
      ...observation,
      verification: {
        status: result.status,
        ...(result.status === "skipped"
          ? {}
          : { verifiedAt: result.completedAt }),
        ...(result.status === "skipped" ? {} : { source: "probe" as const }),
        ...(evidenceExcerpt === undefined
          ? {}
          : {
              evidence: {
                source: "probe" as const,
                excerpt: evidenceExcerpt,
                capturedAt: result.completedAt,
              },
            }),
      },
    };
  });
  const passed = run.results.some((result) => result.status === "passed");
  const lastVerifiedAt = run.results
    .map((result) => result.completedAt)
    .sort()
    .at(-1);
  return assertHarnessProfile({
    ...profile,
    capabilities,
    lifecycle: passed ? "verified" : profile.lifecycle,
    ...(lastVerifiedAt === undefined ? {} : { lastVerifiedAt }),
    updatedAt: now().toISOString(),
  });
}

function statusFor(records: readonly VerifyRecord[]): VerifyCommandStatus {
  if (records.length === 0) return "empty";
  return records.every((record) => record.status === "passed") ? "success" : "partial";
}

export async function verify(
  options: VerifyCommandOptions = {},
): Promise<VerifyCommandResult> {
  const config = options.config ?? await loadSwitchyardConfig(options.configPath, {
    env: options.env,
  });
  const registryPath = resolveEffectiveRegistryPath(options.registryPath, config, {
    env: options.env,
  });
  const cached = await readRegistry(registryPath);
  if (cached === undefined) {
    return {
      schemaVersion: COMMAND_SCHEMA_VERSION,
      command: "verify",
      status: "empty",
      registryPath,
      harnesses: [],
      capabilities: options.capabilities ?? [],
      warnings: [],
      verifications: [],
    };
  }

  const registry = markStaleEntries(cached, {
    staleAfterMs: options.staleAfterMs,
    now: options.now,
  });
  const selected = registry.harnesses.filter((profile) =>
    options.harnessId === undefined || profile.id === options.harnessId);
  const adapters = toRegistry(options.adapters);
  const now = options.now ?? (() => new Date());
  const updated = new Map(registry.harnesses.map((profile) => [profile.id, profile]));
  const records: VerifyRecord[] = [];
  const warnings: VerifyWarning[] = [];
  const requestedCapabilities = new Set<CapabilityName>();

  for (const profile of selected) {
    const capabilities = profileCapabilities(profile, options.capabilities);
    capabilities.forEach((capability) => requestedCapabilities.add(capability));
    if (capabilities.length === 0) continue;
    const adapter = adapters.get(profile.id);
    let run: VerificationRunResult;
    if (adapter === undefined || !adapter.supportedOperations.verify) {
      run = unsupportedResults(capabilities, now, "Verification is unavailable for this harness");
    } else {
      const runOptions: VerificationRunOptions = {
        policy: policyFor(profile.id, config, options),
        ...(options.risks === undefined ? {} : { risks: options.risks }),
        ...(options.risksByCapability === undefined
          ? {}
          : { risksByCapability: options.risksByCapability }),
        context: {
          timeoutMs: resolveHarnessRuntimeConfig(profile.id, config, {}, options.env).timeoutMs,
        },
        ...(options.now === undefined ? {} : { now: options.now }),
      };
      try {
        run = await verifyCapabilities(adapter, capabilities, runOptions);
      } catch (error: unknown) {
        run = unsupportedResults(
          capabilities,
          now,
          error instanceof Error ? redactSecrets(error.message) : "Verification failed",
        );
      }
    }
    updated.set(profile.id, updateProfile(profile, run, now));
    for (const result of run.results) {
      records.push({
        harnessId: profile.id,
        capability: result.capability,
        status: result.status,
        startedAt: result.startedAt,
        completedAt: result.completedAt,
        ...(result.message === undefined ? {} : { message: redactSecrets(result.message) }),
      });
    }
    warnings.push(...run.warnings.map((warning) => ({
      harnessId: profile.id,
      capability: warning.capability,
      risks: warning.risks,
      messages: warning.messages.map((message) => redactSecrets(message)),
    })));
  }

  const resultRegistry = {
    ...registry,
    harnesses: [...updated.values()],
    updatedAt: now().toISOString(),
  };
  await writeRegistry(registryPath, resultRegistry);
  return {
    schemaVersion: COMMAND_SCHEMA_VERSION,
    command: "verify",
    status: statusFor(records),
    registryPath,
    harnesses: selected.map((profile) => profile.id),
    capabilities: [...requestedCapabilities],
    warnings,
    verifications: records,
  };
}

export const verifyCommand = verify;

export function formatVerifyJson(result: VerifyCommandResult): string {
  return serializeCommandJson(result);
}

export function formatVerifyHuman(result: VerifyCommandResult): string {
  const lines = [
    "Switchyard verification",
    `Registry: ${result.registryPath}`,
    `Status: ${result.status}`,
    `Harnesses: ${result.harnesses.length > 0 ? result.harnesses.join(", ") : "none"}`,
  ];
  for (const warning of result.warnings) {
    lines.push(
      `Warning [${warning.harnessId}/${warning.capability}]: ${warning.messages.join(" ")}`,
    );
  }
  for (const record of result.verifications) {
    lines.push(
      `- ${record.harnessId}/${record.capability}: ${record.status}${record.message === undefined ? "" : ` (${record.message})`}`,
    );
  }
  if (result.verifications.length === 0) lines.push("- no capabilities were verified");
  return lines.join("\n");
}
