import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  assertSwitchyardConfig,
  ConfigValidationError,
  type ConfigIssue,
  type SwitchyardConfig,
} from "./schema.ts";

export type ConfigPlatform = "darwin" | "linux" | "win32";

export interface ConfigPathOptions {
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly platform?: ConfigPlatform;
  readonly homeDirectory?: string;
}

export interface ConfigReadOptions {
  /** A missing configuration file is normal and yields `undefined`. */
  readonly allowMissing?: boolean;
}

const DEFAULT_PLATFORM: ConfigPlatform =
  process.platform === "win32"
    ? "win32"
    : process.platform === "darwin"
      ? "darwin"
      : "linux";

function environmentValue(
  env: Readonly<Record<string, string | undefined>>,
  name: string,
  platform: ConfigPlatform,
): string | undefined {
  if (platform !== "win32") {
    return env[name];
  }
  const key = Object.keys(env).find((candidate) => candidate.toUpperCase() === name);
  return key === undefined ? undefined : env[key];
}

/**
 * Resolves the per-user configuration file location, mirroring
 * `defaultRegistryPath` so both files live under the same platform-specific
 * Switchyard directory.
 */
export function defaultConfigPath(options: ConfigPathOptions = {}): string {
  const env = options.env ?? process.env;
  const platform = options.platform ?? DEFAULT_PLATFORM;
  const home = options.homeDirectory ?? environmentValue(env, "HOME", platform) ?? homedir();

  if (platform === "win32") {
    const appData =
      environmentValue(env, "APPDATA", platform) ?? join(home, "AppData", "Roaming");
    return join(appData, "switchyard", "config.json");
  }
  if (platform === "darwin") {
    return join(home, "Library", "Application Support", "switchyard", "config.json");
  }

  const configHome = environmentValue(env, "XDG_CONFIG_HOME", platform) ?? join(home, ".config");
  return join(configHome, "switchyard", "config.json");
}

/**
 * Applies the explicit `SWITCHYARD_CONFIG_PATH` environment override, then
 * falls back to the platform-appropriate per-user path. An explicit
 * argument takes precedence over both.
 */
export function resolveConfigPath(
  explicitPath?: string | URL,
  options: ConfigPathOptions = {},
): string {
  if (explicitPath instanceof URL) {
    if (explicitPath.protocol !== "file:") {
      throw new TypeError("Configuration path must be a local file URL");
    }
    return resolve(fileURLToPath(explicitPath));
  }
  if (
    explicitPath !== undefined &&
    (explicitPath.length === 0 || explicitPath.includes("\u0000"))
  ) {
    throw new TypeError("Configuration path must be a non-empty local path without NUL characters");
  }
  const env = options.env ?? process.env;
  const configured =
    explicitPath ??
    environmentValue(env, "SWITCHYARD_CONFIG_PATH", options.platform ?? DEFAULT_PLATFORM);
  return resolve(configured ?? defaultConfigPath(options));
}

export type ConfigPersistenceErrorCode =
  | "invalid-path"
  | "invalid-json"
  | "invalid-schema"
  | "read-failed";

/**
 * Error raised when a local configuration file cannot be safely loaded. The
 * message and `issues` never include the file's field values, only field
 * paths and expected shapes, so a misconfigured executable path or a
 * pasted-in secret-looking string is never echoed back.
 */
export class ConfigPersistenceError extends Error {
  readonly code: ConfigPersistenceErrorCode;
  readonly path: string;
  readonly issues: readonly ConfigIssue[];
  readonly cause?: unknown;

  constructor(
    code: ConfigPersistenceErrorCode,
    path: string,
    message: string,
    options: { readonly issues?: readonly ConfigIssue[]; readonly cause?: unknown } = {},
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "ConfigPersistenceError";
    this.code = code;
    this.path = path;
    this.issues = options.issues ?? [];
    this.cause = options.cause;
  }
}

function isFileSystemError(error: unknown, code: string): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === code;
}

/**
 * Reads and validates the local configuration file. A missing file is
 * normal before a user has created one; it resolves to `undefined` unless
 * `allowMissing` is `false`.
 */
export async function readSwitchyardConfig(
  configPath: string,
  options: ConfigReadOptions = {},
): Promise<SwitchyardConfig | undefined> {
  const target = resolve(configPath);

  let contents: string;
  try {
    contents = await readFile(target, "utf8");
  } catch (error: unknown) {
    if (isFileSystemError(error, "ENOENT") && options.allowMissing !== false) {
      return undefined;
    }
    throw new ConfigPersistenceError(
      "read-failed",
      target,
      "Configuration file could not be read",
      { cause: error },
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(contents) as unknown;
  } catch (error: unknown) {
    throw new ConfigPersistenceError(
      "invalid-json",
      target,
      "Configuration file contains invalid JSON",
      { cause: error },
    );
  }

  try {
    return assertSwitchyardConfig(parsed);
  } catch (error: unknown) {
    if (error instanceof ConfigValidationError) {
      throw new ConfigPersistenceError(
        "invalid-schema",
        target,
        "Configuration file does not match the supported configuration schema",
        { cause: error, issues: error.issues },
      );
    }
    throw new ConfigPersistenceError(
      "invalid-schema",
      target,
      "Configuration file could not be validated",
      { cause: error },
    );
  }
}

/**
 * Convenience variant that always resolves to a usable configuration
 * object: a missing file yields an empty (schema-default) configuration
 * rather than `undefined`.
 */
export async function loadSwitchyardConfig(
  configPath?: string | URL,
  options: ConfigPathOptions = {},
): Promise<SwitchyardConfig> {
  const resolvedPath = resolveConfigPath(configPath, options);
  const config = await readSwitchyardConfig(resolvedPath);
  return config ?? { schemaVersion: 1 };
}
