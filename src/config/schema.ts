/**
 * Typed local configuration schema for Switchyard: known harnesses,
 * per-harness executable overrides, and probe policy. Configuration
 * diagnostics identify the offending field path and describe the expected
 * shape; they never echo the submitted value, so a path or executable
 * override that happens to embed a secret-looking string is never
 * reproduced in an error message or log.
 */

export const CONFIG_SCHEMA_VERSION = 1 as const;

/**
 * Policy for capability-verification probes. Mutating, external, or paid
 * probes must remain opt-in (`allowMutatingProbes`); read-only bounded
 * probes are the default everywhere in this project.
 */
export interface ProbePolicyConfig {
  /** Maximum time in milliseconds a single probe may run. */
  readonly timeoutMs?: number;
  /** Maximum captured output length in characters before truncation. */
  readonly maxOutputLength?: number;
  /** Opt-in flag for probes that may mutate state, call external services, or incur cost. */
  readonly allowMutatingProbes?: boolean;
  /** Opt in to probes that contact external services. */
  readonly allowExternalAccess?: boolean;
  /** Opt in to probes that may incur provider charges. */
  readonly allowPaidProbes?: boolean;
  /** Opt in to probes that invoke a model. */
  readonly allowModelInvocation?: boolean;
}

/** Per-harness configuration entry. */
export interface HarnessConfigEntry {
  /** Explicit executable location, checked before PATH but after CLI/env overrides. */
  readonly executable?: string;
  readonly probePolicy?: ProbePolicyConfig;
}

/** The typed shape of the local Switchyard configuration file. */
export interface SwitchyardConfig {
  readonly schemaVersion?: typeof CONFIG_SCHEMA_VERSION;
  /** Overrides the default per-user registry location. */
  readonly registryPath?: string;
  /** Default probe policy applied to every harness unless overridden per-harness. */
  readonly probePolicy?: ProbePolicyConfig;
  readonly harnesses?: Readonly<Record<string, HarnessConfigEntry>>;
}

export interface ConfigIssue {
  readonly path: string;
  readonly message: string;
}

export type ConfigValidationResult<T> =
  | { readonly success: true; readonly value: T; readonly issues: readonly [] }
  | { readonly success: false; readonly issues: readonly ConfigIssue[] };

/**
 * Raised when a local configuration file or a resolved field fails
 * validation. `issues` is structured (path + message) so callers can render
 * an actionable, field-specific diagnostic without interpolating the
 * original (potentially sensitive) value into the message.
 */
export class ConfigValidationError extends Error {
  readonly issues: readonly ConfigIssue[];

  constructor(issues: readonly ConfigIssue[]) {
    super(
      `Switchyard configuration is invalid: ${issues
        .map((issue) => `${issue.path} ${issue.message}`)
        .join("; ")}`,
    );
    this.name = "ConfigValidationError";
    this.issues = issues;
  }
}

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const HARNESS_ID = /^[a-z0-9][a-z0-9._-]*$/;
const MAX_PATH_LENGTH = 4096;
const MAX_TIMEOUT_MS = 10 * 60 * 1000;
const MAX_OUTPUT_LENGTH_CEILING = 1024 * 1024;

function hasOnlyKeys(
  value: UnknownRecord,
  allowed: readonly string[],
  path: string,
  issues: ConfigIssue[],
): void {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) {
      issues.push({ path: `${path}.${key}`, message: "is not a recognized field" });
    }
  }
}

function validateNonEmptyString(
  value: unknown,
  path: string,
  issues: ConfigIssue[],
  maxLength: number = MAX_PATH_LENGTH,
): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || value.length === 0) {
    issues.push({ path, message: "must be a non-empty string" });
    return undefined;
  }
  if (value.length > maxLength) {
    issues.push({ path, message: `must be at most ${maxLength} characters` });
    return undefined;
  }
  if (value.includes("\u0000")) {
    issues.push({ path, message: "must not contain NUL characters" });
    return undefined;
  }
  return value;
}

function validatePositiveInteger(
  value: unknown,
  path: string,
  issues: ConfigIssue[],
  ceiling: number,
): number | undefined {
  if (value === undefined) return undefined;
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    !Number.isInteger(value) ||
    value <= 0
  ) {
    issues.push({ path, message: "must be a positive integer" });
    return undefined;
  }
  if (value > ceiling) {
    issues.push({ path, message: `must be at most ${ceiling}` });
    return undefined;
  }
  return value;
}

function validateBoolean(
  value: unknown,
  path: string,
  issues: ConfigIssue[],
): boolean | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "boolean") {
    issues.push({ path, message: "must be a boolean" });
    return undefined;
  }
  return value;
}

function validateProbePolicy(
  value: unknown,
  path: string,
  issues: ConfigIssue[],
): ProbePolicyConfig | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) {
    issues.push({ path, message: "must be an object" });
    return undefined;
  }
  hasOnlyKeys(value, [
    "timeoutMs",
    "maxOutputLength",
    "allowMutatingProbes",
    "allowExternalAccess",
    "allowPaidProbes",
    "allowModelInvocation",
  ], path, issues);
  const timeoutMs = validatePositiveInteger(
    value.timeoutMs,
    `${path}.timeoutMs`,
    issues,
    MAX_TIMEOUT_MS,
  );
  const maxOutputLength = validatePositiveInteger(
    value.maxOutputLength,
    `${path}.maxOutputLength`,
    issues,
    MAX_OUTPUT_LENGTH_CEILING,
  );
  const allowMutatingProbes = validateBoolean(
    value.allowMutatingProbes,
    `${path}.allowMutatingProbes`,
    issues,
  );
  const allowExternalAccess = validateBoolean(
    value.allowExternalAccess,
    `${path}.allowExternalAccess`,
    issues,
  );
  const allowPaidProbes = validateBoolean(value.allowPaidProbes, `${path}.allowPaidProbes`, issues);
  const allowModelInvocation = validateBoolean(
    value.allowModelInvocation,
    `${path}.allowModelInvocation`,
    issues,
  );
  return {
    ...(timeoutMs === undefined ? {} : { timeoutMs }),
    ...(maxOutputLength === undefined ? {} : { maxOutputLength }),
    ...(allowMutatingProbes === undefined ? {} : { allowMutatingProbes }),
    ...(allowExternalAccess === undefined ? {} : { allowExternalAccess }),
    ...(allowPaidProbes === undefined ? {} : { allowPaidProbes }),
    ...(allowModelInvocation === undefined ? {} : { allowModelInvocation }),
  };
}

function validateHarnessEntry(
  value: unknown,
  path: string,
  issues: ConfigIssue[],
): HarnessConfigEntry | undefined {
  if (!isRecord(value)) {
    issues.push({ path, message: "must be an object" });
    return undefined;
  }
  hasOnlyKeys(value, ["executable", "probePolicy"], path, issues);
  const executable = validateNonEmptyString(value.executable, `${path}.executable`, issues);
  const probePolicy = validateProbePolicy(value.probePolicy, `${path}.probePolicy`, issues);
  return {
    ...(executable === undefined ? {} : { executable }),
    ...(probePolicy === undefined ? {} : { probePolicy }),
  };
}

function validateHarnessMap(
  value: unknown,
  path: string,
  issues: ConfigIssue[],
): Record<string, HarnessConfigEntry> | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) {
    issues.push({ path, message: "must be an object mapping harness id to configuration" });
    return undefined;
  }
  const result: Record<string, HarnessConfigEntry> = {};
  for (const [harnessId, entryValue] of Object.entries(value)) {
    const entryPath = `${path}.${harnessId}`;
    if (!HARNESS_ID.test(harnessId)) {
      issues.push({
        path: entryPath,
        message: "harness id must be lowercase alphanumeric with '.', '_', or '-' separators",
      });
      continue;
    }
    const entry = validateHarnessEntry(entryValue, entryPath, issues);
    if (entry !== undefined) {
      result[harnessId] = entry;
    }
  }
  return result;
}

function validResult<T>(value: T): ConfigValidationResult<T> {
  return { success: true, value, issues: [] };
}

function invalidResult<T>(issues: ConfigIssue[]): ConfigValidationResult<T> {
  return { success: false, issues };
}

/**
 * Validates an unknown value against the typed Switchyard configuration
 * schema. Every issue names the offending field path and expected shape;
 * none echo the submitted value.
 */
export function validateSwitchyardConfig(
  input: unknown,
): ConfigValidationResult<SwitchyardConfig> {
  const issues: ConfigIssue[] = [];

  if (!isRecord(input)) {
    return invalidResult([{ path: "$", message: "must be an object" }]);
  }

  hasOnlyKeys(
    input,
    ["schemaVersion", "registryPath", "probePolicy", "harnesses"],
    "$",
    issues,
  );

  if (input.schemaVersion !== undefined && input.schemaVersion !== CONFIG_SCHEMA_VERSION) {
    issues.push({
      path: "$.schemaVersion",
      message: `must be ${CONFIG_SCHEMA_VERSION} when present`,
    });
  }

  const registryPath = validateNonEmptyString(input.registryPath, "$.registryPath", issues);
  const probePolicy = validateProbePolicy(input.probePolicy, "$.probePolicy", issues);
  const harnesses = validateHarnessMap(input.harnesses, "$.harnesses", issues);

  if (issues.length > 0) {
    return invalidResult(issues);
  }

  return validResult({
    schemaVersion: CONFIG_SCHEMA_VERSION,
    ...(registryPath === undefined ? {} : { registryPath }),
    ...(probePolicy === undefined ? {} : { probePolicy }),
    ...(harnesses === undefined ? {} : { harnesses }),
  });
}

export function isSwitchyardConfig(input: unknown): input is SwitchyardConfig {
  return validateSwitchyardConfig(input).success;
}

export function assertSwitchyardConfig(input: unknown): SwitchyardConfig {
  const result = validateSwitchyardConfig(input);
  if (!result.success) {
    throw new ConfigValidationError(result.issues);
  }
  return result.value;
}
