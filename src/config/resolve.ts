import { ConfigValidationError, type ConfigIssue, type SwitchyardConfig } from "./schema.ts";
import { resolveRegistryPath, type RegistryPathOptions } from "./registry.ts";

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

/**
 * A single harness's fully resolved runtime configuration. `executable`
 * carries the highest-precedence (explicit or environment) override and
 * `configuredExecutable` carries the local-config-file value; both map
 * directly onto `HarnessDiscoveryOptions`, so passing this object's fields
 * to discovery, verification, and execution guarantees the same resolved
 * location is used everywhere.
 */
export interface ResolvedHarnessRuntimeConfig {
  readonly harnessId: string;
  readonly executable?: string;
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

  const envExecutable = readEnv(env, `SWITCHYARD_${segment}_EXECUTABLE`, platform);
  const executable = overrides.executable ?? envExecutable;
  const configuredExecutable = harnessConfig?.executable;

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
    ...(executable === undefined ? {} : { executable }),
    ...(configuredExecutable === undefined ? {} : { configuredExecutable }),
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
