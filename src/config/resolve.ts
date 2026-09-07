import { posix, win32 } from "node:path";

import { ConfigValidationError, type ConfigIssue, type SwitchyardConfig } from "./schema.ts";
import { resolveRegistryPath, type RegistryPathOptions } from "./registry.ts";
import type { ExecutableSource } from "../discovery/schema.ts";

export type ConfigResolutionPlatform = "darwin" | "linux" | "win32";

const DEFAULT_PLATFORM: ConfigResolutionPlatform =
  process.platform === "win32"
    ? "win32"
    : process.platform === "darwin"
      ? "darwin"
      : "linux";

/**
 * Explicit, call-time overrides for a single harness (for example, CLI flags
 * or values passed directly by a command). These always take precedence
 * over environment variables and the local configuration file.
 */
export interface HarnessRuntimeOverrides {
  readonly executable?: string;
  readonly cwd?: string;
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly timeoutMs?: number;
  readonly maxOutputLength?: number;
  readonly allowMutatingProbes?: boolean;
  readonly platform?: ConfigResolutionPlatform;
}

export interface ResolvedExecutableOverride {
  /**
   * The single, normalized executable override every adapter operation on
   * the constructed instance must use. When the containing
   * `executableOverride` is absent, adapters search PATH using their
   * built-in command.
   */
  readonly executable: string;
  /** How discovery should report the executable once it is located. */
  readonly source: Extract<ExecutableSource, "override" | "configured">;
  /** Field that supplied the value, suitable for actionable diagnostics. */
  readonly field: string;
}

/**
 * A single harness's fully resolved runtime configuration. `executable`
 * is the one normalized executable override selected from explicit,
 * environment, or local configuration values; `executableSource` preserves
 * whether discovery should report it as an explicit override or a configured
 * executable. Passing this object to an adapter factory gives discovery,
 * verification, and execution the same executable without re-resolving.
 *
 * `configuredExecutable` is retained as a compatibility alias for older
 * discovery-only wiring. New callers should prefer `executable` plus
 * `executableSource`/`executableOverride`.
 */
export interface ResolvedHarnessRuntimeConfig {
  readonly harnessId: string;
  readonly executableOverride?: ResolvedExecutableOverride;
  readonly executable?: string;
  readonly executableSource?: Extract<ExecutableSource, "override" | "configured">;
  readonly executableField?: string;
  readonly configuredExecutable?: string;
  readonly cwd?: string;
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly timeoutMs: number;
  readonly maxOutputLength: number;
  readonly allowMutatingProbes: boolean;
}

export const DEFAULT_PROBE_TIMEOUT_MS = 5000;
export const DEFAULT_PROBE_MAX_OUTPUT_LENGTH = 8192;
export const DEFAULT_ALLOW_MUTATING_PROBES = false;
const MAX_EXECUTABLE_PATH_LENGTH = 4096;

function environmentKeySegment(harnessId: string): string {
  return harnessId.toUpperCase().replace(/[^A-Z0-9]/g, "_");
}

function readEnv(
  env: Readonly<Record<string, string | undefined>>,
  name: string,
  platform: ConfigResolutionPlatform,
): string | undefined {
  if (platform === "win32") {
    const key = Object.keys(env).find((candidate) => candidate.toUpperCase() === name);
    const value = key === undefined ? undefined : env[key];
    return value === undefined || value.length === 0 ? undefined : value;
  }
  const value = env[name];
  return value === undefined || value.length === 0 ? undefined : value;
}

function validateExecutableValue(
  value: string,
  field: string,
  issues: ConfigIssue[],
): boolean {
  if (value.length === 0) {
    issues.push({ path: field, message: "must be a non-empty string" });
    return false;
  }
  if (value.length > MAX_EXECUTABLE_PATH_LENGTH) {
    issues.push({
      path: field,
      message: `must be at most ${MAX_EXECUTABLE_PATH_LENGTH} characters`,
    });
    return false;
  }
  if (value.includes("\u0000")) {
    issues.push({ path: field, message: "must not contain NUL characters" });
    return false;
  }
  return true;
}

function normalizeExecutablePath(
  value: string,
  cwd: string,
  platform: ConfigResolutionPlatform,
): string {
  const pathApi = platform === "win32" ? win32 : posix;
  return pathApi.normalize(pathApi.isAbsolute(value) ? value : pathApi.resolve(cwd, value));
}

function resolveExecutableOverride(
  harnessId: string,
  config: SwitchyardConfig,
  overrides: HarnessRuntimeOverrides,
  env: Readonly<Record<string, string | undefined>>,
  platform: ConfigResolutionPlatform,
  issues: ConfigIssue[],
): ResolvedExecutableOverride | undefined {
  const segment = environmentKeySegment(harnessId);
  const envName = `SWITCHYARD_${segment}_EXECUTABLE`;
  const envExecutable = readEnv(env, envName, platform);
  const harnessConfig = config.harnesses?.[harnessId];
  const cwd = overrides.cwd ?? process.cwd();

  const candidates: readonly {
    readonly value: string | undefined;
    readonly source: Extract<ExecutableSource, "override" | "configured">;
    readonly field: string;
  }[] = [
    {
      value: overrides.executable,
      source: "override",
      field: `overrides.${harnessId}.executable`,
    },
    {
      value: envExecutable,
      source: "override",
      field: `env.${envName}`,
    },
    {
      value: harnessConfig?.executable,
      source: "configured",
      field: `$.harnesses.${harnessId}.executable`,
    },
  ];

  for (const candidate of candidates) {
    if (candidate.value === undefined) {
      continue;
    }
    if (!validateExecutableValue(candidate.value, candidate.field, issues)) {
      return undefined;
    }
    return {
      executable: normalizeExecutablePath(candidate.value, cwd, platform),
      source: candidate.source,
      field: candidate.field,
    };
  }

  return undefined;
}

function parseEnvPositiveInteger(
  env: Readonly<Record<string, string | undefined>>,
  name: string,
  platform: ConfigResolutionPlatform,
  issues: ConfigIssue[],
): number | undefined {
  const raw = readEnv(env, name, platform);
  if (raw === undefined) return undefined;
  const value = Number(raw);
  if (!Number.isFinite(value) || !Number.isInteger(value) || value <= 0) {
    issues.push({ path: `env.${name}`, message: "must be a positive integer" });
    return undefined;
  }
  return value;
}

function parseEnvBoolean(
  env: Readonly<Record<string, string | undefined>>,
  name: string,
  platform: ConfigResolutionPlatform,
  issues: ConfigIssue[],
): boolean | undefined {
  const raw = readEnv(env, name, platform);
  if (raw === undefined) return undefined;
  const normalized = raw.trim().toLowerCase();
  if (normalized === "1" || normalized === "true") return true;
  if (normalized === "0" || normalized === "false") return false;
  issues.push({ path: `env.${name}`, message: "must be '1', '0', 'true', or 'false'" });
  return undefined;
}

/**
 * Resolves one harness's complete runtime configuration by applying a fixed
 * precedence — explicit call-time override, then environment variable, then
 * the local configuration file, then a built-in default — to every field.
 * The same precedence order applies uniformly across executable, timeout,
 * output-length, and probe-policy fields so no field's resolution is a
 * surprise relative to the others.
 *
 * @throws {ConfigValidationError} if an environment override's value cannot
 *   be parsed as the expected type. The error identifies the environment
 *   variable name; it never echoes the invalid value.
 */
export function resolveHarnessRuntimeConfig(
  harnessId: string,
  config: SwitchyardConfig = {},
  overrides: HarnessRuntimeOverrides = {},
  env: Readonly<Record<string, string | undefined>> = process.env,
): ResolvedHarnessRuntimeConfig {
  const issues: ConfigIssue[] = [];
  const platform = overrides.platform ?? DEFAULT_PLATFORM;
  const segment = environmentKeySegment(harnessId);
  const harnessConfig = config.harnesses?.[harnessId];

  const executableOverride = resolveExecutableOverride(
    harnessId,
    config,
    overrides,
    env,
    platform,
    issues,
  );

  const envTimeoutMs =
    parseEnvPositiveInteger(env, `SWITCHYARD_${segment}_PROBE_TIMEOUT_MS`, platform, issues) ??
    parseEnvPositiveInteger(env, "SWITCHYARD_PROBE_TIMEOUT_MS", platform, issues);
  const timeoutMs =
    overrides.timeoutMs ??
    envTimeoutMs ??
    harnessConfig?.probePolicy?.timeoutMs ??
    config.probePolicy?.timeoutMs ??
    DEFAULT_PROBE_TIMEOUT_MS;

  const envMaxOutputLength =
    parseEnvPositiveInteger(
      env,
      `SWITCHYARD_${segment}_PROBE_MAX_OUTPUT_LENGTH`,
      platform,
      issues,
    ) ?? parseEnvPositiveInteger(env, "SWITCHYARD_PROBE_MAX_OUTPUT_LENGTH", platform, issues);
  const maxOutputLength =
    overrides.maxOutputLength ??
    envMaxOutputLength ??
    harnessConfig?.probePolicy?.maxOutputLength ??
    config.probePolicy?.maxOutputLength ??
    DEFAULT_PROBE_MAX_OUTPUT_LENGTH;

  const envAllowMutatingProbes =
    parseEnvBoolean(env, `SWITCHYARD_${segment}_ALLOW_MUTATING_PROBES`, platform, issues) ??
    parseEnvBoolean(env, "SWITCHYARD_ALLOW_MUTATING_PROBES", platform, issues);
  const allowMutatingProbes =
    overrides.allowMutatingProbes ??
    envAllowMutatingProbes ??
    harnessConfig?.probePolicy?.allowMutatingProbes ??
    config.probePolicy?.allowMutatingProbes ??
    DEFAULT_ALLOW_MUTATING_PROBES;

  if (issues.length > 0) {
    throw new ConfigValidationError(issues);
  }

  return {
    harnessId,
    ...(executableOverride === undefined ? {} : { executableOverride }),
    ...(executableOverride === undefined ? {} : { executable: executableOverride.executable }),
    ...(executableOverride === undefined ? {} : { executableSource: executableOverride.source }),
    ...(executableOverride === undefined ? {} : { executableField: executableOverride.field }),
    ...(executableOverride?.source === "configured"
      ? { configuredExecutable: executableOverride.executable }
      : {}),
    ...(overrides.cwd === undefined ? {} : { cwd: overrides.cwd }),
    ...(overrides.env === undefined ? {} : { env: overrides.env }),
    timeoutMs,
    maxOutputLength,
    allowMutatingProbes,
  };
}

/**
 * Resolves the effective registry path with the same precedence used
 * elsewhere: explicit argument, then `SWITCHYARD_REGISTRY_PATH`, then the
 * local configuration file's `registryPath`, then the platform default.
 */
export function resolveEffectiveRegistryPath(
  explicitPath: string | URL | undefined,
  config: SwitchyardConfig = {},
  options: RegistryPathOptions = {},
): string {
  const env = options.env ?? process.env;
  const platform = options.platform ?? DEFAULT_PLATFORM;
  const envValue = readEnv(env, "SWITCHYARD_REGISTRY_PATH", platform);
  if (explicitPath !== undefined || envValue !== undefined) {
    return resolveRegistryPath(explicitPath, options);
  }
  if (config.registryPath !== undefined) {
    return resolveRegistryPath(config.registryPath, options);
  }
  return resolveRegistryPath(undefined, options);
}
