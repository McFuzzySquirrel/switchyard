import {
  CAPABILITY_NAMES,
  type CapabilityName,
} from "../capabilities/vocabulary.ts";
import {
  findExecutable,
  type ExecutableLookupOptions,
} from "../discovery/executable.ts";
import {
  boundExcerpt,
  probeHarnessMetadata,
  redactSecrets,
} from "../discovery/probe.ts";
import {
  assertHarnessProfile,
  DISCOVERY_SCHEMA_VERSION,
  type CapabilityObservation,
  type HarnessDiagnostic,
  type HarnessProfile,
} from "../discovery/schema.ts";
import {
  DISCOVERY_ONLY_OPERATIONS,
  type AdapterOperationSupport,
} from "./adapter.ts";

/**
 * Options shared by all discovery adapters. `executable` is an explicit
 * per-invocation override and is checked before configured locations or PATH.
 */
export interface HarnessDiscoveryOptions {
  readonly executable?: string;
  readonly configuredExecutable?: string;
  readonly cwd?: string;
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly timeoutMs?: number;
  readonly maxOutputLength?: number;
  readonly signal?: AbortSignal;
  /** Allows deterministic profile timestamps in callers and fixture tests. */
  readonly now?: () => Date;
}

/**
 * Read-only adapter boundary used by the discovery subsystem. It intentionally
 * declares operation support separately from `HarnessAdapter`: discovery can
 * ship before the execution runtime provides an invocation implementation.
 */
export interface HarnessDiscoveryAdapter {
  readonly id: string;
  readonly displayName: string;
  readonly command: string;
  readonly supportedOperations: AdapterOperationSupport;
  discover(options?: HarnessDiscoveryOptions): Promise<HarnessProfile>;
}

export interface HarnessDiscoveryAdapterDefinition {
  readonly id: string;
  readonly displayName: string;
  readonly command: string;
  readonly versionCandidateArgs?: readonly (readonly string[])[];
  readonly helpCandidateArgs?: readonly (readonly string[])[];
  /**
   * Maps vendor help text to the shared vocabulary. Vendor-specific matching
   * belongs to the defining adapter module, never to routing or discovery.
   */
  readonly parseCapabilities: (helpText: string) => readonly CapabilityName[];
  /**
   * Discovery-only adapters must explicitly reject the operations that their
   * execution counterpart has not implemented yet.
   */
  readonly supportedOperations?: AdapterOperationSupport;
}

function observedCapabilities(
  capabilities: readonly CapabilityName[],
  helpText: string,
  observedAt: string,
  maxOutputLength: number | undefined,
): readonly CapabilityObservation[] {
  const detected = new Set(capabilities);
  const evidenceExcerpt = boundExcerpt(helpText, maxOutputLength);

  return CAPABILITY_NAMES
    .filter((capability) => detected.has(capability))
    .map((capability) => ({
      schemaVersion: DISCOVERY_SCHEMA_VERSION,
      capability,
      discovery: {
        status: "observed" as const,
        source: "help" as const,
        observedAt,
        evidence: {
          source: "help" as const,
          excerpt: evidenceExcerpt,
          capturedAt: observedAt,
          reference: "--help",
        },
      },
      verification: { status: "not-requested" as const },
    }));
}

function unavailableProfile(
  definition: HarnessDiscoveryAdapterDefinition,
  executable: string,
  executableSource: HarnessProfile["executableSource"],
  checkedAt: string,
  code: string,
  reason: string,
  status: "unavailable" | "malformed" = "unavailable",
): HarnessProfile {
  const diagnostic: HarnessDiagnostic = {
    code,
    message: boundExcerpt(redactSecrets(reason), 1024) || "Harness is unavailable",
    at: checkedAt,
  };

  return assertHarnessProfile({
    schemaVersion: DISCOVERY_SCHEMA_VERSION,
    id: definition.id,
    displayName: definition.displayName,
    executable,
    executableSource,
    capabilities: [],
    status,
    lifecycle: status === "unavailable" ? "unavailable" : "discovered",
    availability: {
      status,
      checkedAt,
      reason: diagnostic.message,
    },
    discoveredAt: checkedAt,
    updatedAt: checkedAt,
    diagnostics: [diagnostic],
  });
}

function unavailableLocation(
  definition: HarnessDiscoveryAdapterDefinition,
  options: HarnessDiscoveryOptions,
): { readonly executable: string; readonly source: HarnessProfile["executableSource"] } {
  if (options.executable !== undefined) {
    return { executable: options.executable, source: "override" };
  }
  if (options.configuredExecutable !== undefined) {
    return { executable: options.configuredExecutable, source: "configured" };
  }
  return { executable: definition.command, source: "path" };
}

/**
 * Creates a bounded, schema-valid discovery adapter from vendor-local parsing
 * rules. Probes use only the adapter's documented candidate flags; they never
 * execute parsed output or invoke a shell.
 */
export function createHarnessDiscoveryAdapter(
  definition: HarnessDiscoveryAdapterDefinition,
): HarnessDiscoveryAdapter {
  const supportedOperations = definition.supportedOperations ?? DISCOVERY_ONLY_OPERATIONS;

  return Object.freeze({
    id: definition.id,
    displayName: definition.displayName,
    command: definition.command,
    supportedOperations,
    async discover(options: HarnessDiscoveryOptions = {}): Promise<HarnessProfile> {
      const checkedAt = (options.now ?? (() => new Date()))().toISOString();
      if (options.signal?.aborted) {
        const location = unavailableLocation(definition, options);
        return unavailableProfile(
          definition,
          location.executable,
          location.source,
          checkedAt,
          "probe-aborted",
          `${definition.displayName} discovery was aborted before probing`,
        );
      }
      const lookupOptions: ExecutableLookupOptions = {
        ...(options.executable === undefined ? {} : { overrides: [options.executable] }),
        ...(options.configuredExecutable === undefined
          ? {}
          : { configured: [options.configuredExecutable] }),
        ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
        ...(options.env === undefined ? {} : { env: options.env }),
      };

      let located: Awaited<ReturnType<typeof findExecutable>>;
      try {
        located = await findExecutable(definition.command, lookupOptions);
      } catch (error: unknown) {
        const location = unavailableLocation(definition, options);
        const message = error instanceof Error ? error.message : String(error);
        return unavailableProfile(
          definition,
          location.executable,
          location.source,
          checkedAt,
          "executable-lookup-failed",
          `${definition.displayName} executable lookup failed: ${message}`,
        );
      }

      if (located === undefined) {
        const location = unavailableLocation(definition, options);
        return unavailableProfile(
          definition,
          location.executable,
          location.source,
          checkedAt,
          "executable-not-found",
          `${definition.displayName} executable was not found`,
        );
      }

      let metadata: Awaited<ReturnType<typeof probeHarnessMetadata>>;
      try {
        metadata = await probeHarnessMetadata(located.executable, {
          ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
          ...(options.env === undefined ? {} : { env: options.env }),
          ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
          ...(options.maxOutputLength === undefined
            ? {}
            : { maxOutputLength: options.maxOutputLength }),
          ...(options.signal === undefined ? {} : { signal: options.signal }),
          versionCandidateArgs: definition.versionCandidateArgs,
          helpCandidateArgs: definition.helpCandidateArgs,
        });
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        return unavailableProfile(
          definition,
          located.executable,
          located.source,
          checkedAt,
          "probe-failed",
          `${definition.displayName} metadata probe failed: ${message}`,
        );
      }

      if (metadata.status !== "available") {
        return unavailableProfile(
          definition,
          located.executable,
          located.source,
          checkedAt,
          metadata.status === "malformed" ? "probe-malformed" : "probe-unavailable",
          `${definition.displayName} metadata probe was ${metadata.status}: ${
            metadata.diagnostic ?? "no version or help output was obtained"
          }`,
          metadata.status,
        );
      }

      let capabilities: readonly CapabilityName[];
      try {
        capabilities = definition.parseCapabilities(metadata.helpText ?? "");
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        return unavailableProfile(
          definition,
          located.executable,
          located.source,
          checkedAt,
          "capability-parse-failed",
          `${definition.displayName} capability parsing failed: ${message}`,
          "malformed",
        );
      }

      return assertHarnessProfile({
        schemaVersion: DISCOVERY_SCHEMA_VERSION,
        id: definition.id,
        displayName: definition.displayName,
        executable: located.executable,
        executableSource: located.source,
        ...(metadata.version === undefined ? {} : { version: metadata.version }),
        capabilities: observedCapabilities(
          capabilities,
          metadata.helpText ?? "",
          checkedAt,
          options.maxOutputLength,
        ),
        status: "available",
        lifecycle: "registered",
        availability: { status: "available", checkedAt },
        discoveredAt: checkedAt,
        updatedAt: checkedAt,
      });
    },
  });
}

/** Explicit in-memory registration for built-in and fixture discovery adapters. */
export class HarnessDiscoveryAdapterRegistry {
  readonly #adapters = new Map<string, HarnessDiscoveryAdapter>();

  constructor(adapters: readonly HarnessDiscoveryAdapter[] = []) {
    for (const adapter of adapters) {
      this.register(adapter);
    }
  }

  register(adapter: HarnessDiscoveryAdapter): void {
    if (this.#adapters.has(adapter.id)) {
      throw new Error(`Discovery adapter '${adapter.id}' is already registered`);
    }
    this.#adapters.set(adapter.id, adapter);
  }

  get(id: string): HarnessDiscoveryAdapter | undefined {
    return this.#adapters.get(id);
  }

  list(): readonly HarnessDiscoveryAdapter[] {
    return [...this.#adapters.values()];
  }
}
