import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export type RegistryPlatform = "darwin" | "linux" | "win32";

export interface RegistryPathOptions {
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly platform?: RegistryPlatform;
  readonly homeDirectory?: string;
}

const DEFAULT_PLATFORM: RegistryPlatform =
  process.platform === "win32"
    ? "win32"
    : process.platform === "darwin"
      ? "darwin"
      : "linux";

function environmentValue(
  env: Readonly<Record<string, string | undefined>>,
  name: string,
  platform: RegistryPlatform,
): string | undefined {
  if (platform !== "win32") {
    return env[name];
  }
  const key = Object.keys(env).find((candidate) => candidate.toUpperCase() === name);
  return key === undefined ? undefined : env[key];
}

/**
 * Resolves the per-user registry location. An explicit path is intentionally
 * accepted by callers before this helper is used so tests and CI never need
 * to write to a real user profile.
 */
export function defaultRegistryPath(
  options: RegistryPathOptions = {},
): string {
  const env = options.env ?? process.env;
  const platform = options.platform ?? DEFAULT_PLATFORM;
  const home = options.homeDirectory ?? environmentValue(env, "HOME", platform) ?? homedir();

  if (platform === "win32") {
    const appData =
      environmentValue(env, "APPDATA", platform) ??
      join(home, "AppData", "Roaming");
    return join(appData, "switchyard", "registry.json");
  }
  if (platform === "darwin") {
    return join(home, "Library", "Application Support", "switchyard", "registry.json");
  }

  const configHome =
    environmentValue(env, "XDG_CONFIG_HOME", platform) ??
    join(home, ".config");
  return join(configHome, "switchyard", "registry.json");
}

/**
 * Applies the explicit environment override used by scripts and CI, falling
 * back to the platform-appropriate per-user path.
 */
export function resolveRegistryPath(
  explicitPath?: string | URL,
  options: RegistryPathOptions = {},
): string {
  if (explicitPath instanceof URL) {
    if (explicitPath.protocol !== "file:") {
      throw new TypeError("Registry path must be a local file URL");
    }
    return resolve(fileURLToPath(explicitPath));
  }
  if (explicitPath !== undefined &&
      (explicitPath.length === 0 || explicitPath.includes("\u0000"))) {
    throw new TypeError("Registry path must be a non-empty local path without NUL characters");
  }
  const env = options.env ?? process.env;
  const envValue = environmentValue(
    env,
    "SWITCHYARD_REGISTRY_PATH",
    options.platform ?? DEFAULT_PLATFORM,
  );
  if (explicitPath === undefined && envValue !== undefined && envValue.includes("\u0000")) {
    throw new TypeError("Registry path from SWITCHYARD_REGISTRY_PATH must not contain NUL characters");
  }
  const configured = explicitPath ?? (envValue === "" ? undefined : envValue);
  return resolve(configured ?? defaultRegistryPath(options));
}
