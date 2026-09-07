import { access, lstat } from "node:fs/promises";
import { delimiter, isAbsolute, join, normalize, resolve } from "node:path";
import { constants } from "node:fs";

import type { ExecutableSource } from "./schema.ts";

export type ExecutablePlatform = "darwin" | "linux" | "win32";

export interface ExecutableLookupOptions {
  /**
   * Explicit locations take precedence over PATH. Entries may be absolute or
   * relative to cwd, but command names are intentionally not searched here.
   */
  readonly overrides?: readonly string[];
  /** Configured locations are checked after overrides and before PATH. */
  readonly configured?: readonly string[];
  readonly cwd?: string;
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly platform?: ExecutablePlatform;
}

export interface ExecutableLookupResult {
  readonly executable: string;
  readonly source: ExecutableSource;
}

const DEFAULT_PLATFORM: ExecutablePlatform =
  process.platform === "win32" ? "win32" : process.platform === "darwin" ? "darwin" : "linux";

function environmentValue(
  env: Readonly<Record<string, string | undefined>>,
  name: string,
  platform: ExecutablePlatform,
): string | undefined {
  if (platform !== "win32") {
    return env[name];
  }

  const key = Object.keys(env).find((candidate) => candidate.toUpperCase() === name);
  return key === undefined ? undefined : env[key];
}

function windowsExtensions(env: Readonly<Record<string, string | undefined>>): readonly string[] {
  const pathExt = environmentValue(env, "PATHEXT", "win32") ?? ".COM;.EXE;.BAT;.CMD";
  return pathExt
    .split(";")
    .map((extension) => extension.trim())
    .filter((extension) => extension.length > 0)
    .map((extension) => extension.startsWith(".") ? extension : `.${extension}`);
}

function candidatePaths(
  directory: string,
  command: string,
  platform: ExecutablePlatform,
  env: Readonly<Record<string, string | undefined>>,
): readonly string[] {
  if (platform !== "win32") {
    return [join(directory, command)];
  }

  const extension = command.lastIndexOf(".") > command.lastIndexOf("/") ? command.slice(command.lastIndexOf(".")) : "";
  return extension.length > 0
    ? [join(directory, command)]
    : [join(directory, command), ...windowsExtensions(env).map((suffix) => join(directory, `${command}${suffix}`))];
}

async function isExecutable(path: string, platform: ExecutablePlatform): Promise<boolean> {
  try {
    const metadata = await lstat(path);
    if (!metadata.isFile()) {
      return false;
    }
    if (platform !== "win32") {
      await access(path, constants.X_OK);
    }
    return true;
  } catch (error: unknown) {
    if (error instanceof Error && "code" in error) {
      const code = error.code;
      if (code === "EACCES" || code === "ENOENT" || code === "ENOTDIR") {
        return false;
      }
    }
    throw error;
  }
}

async function findLocation(
  locations: readonly string[] | undefined,
  source: ExecutableSource,
  cwd: string,
  platform: ExecutablePlatform,
): Promise<ExecutableLookupResult | undefined> {
  for (const location of locations ?? []) {
    if (location.length === 0) {
      continue;
    }
    const executable = normalize(isAbsolute(location) ? location : resolve(cwd, location));
    if (await isExecutable(executable, platform)) {
      return { executable, source };
    }
  }
  return undefined;
}

/**
 * Resolves a command to an executable without spawning a shell or interpreting
 * command text. Returns undefined when no executable candidate is available.
 */
export async function findExecutable(
  command: string,
  options: ExecutableLookupOptions = {},
): Promise<ExecutableLookupResult | undefined> {
  if (command.length === 0 || command.includes("\0")) {
    return undefined;
  }

  const platform = options.platform ?? DEFAULT_PLATFORM;
  const env = options.env ?? process.env;
  const cwd = options.cwd ?? process.cwd();
  const override = await findLocation(options.overrides, "override", cwd, platform);
  if (override !== undefined) {
    return override;
  }
  const configured = await findLocation(options.configured, "configured", cwd, platform);
  if (configured !== undefined) {
    return configured;
  }

  if (isAbsolute(command) || command.includes("/") || command.includes("\\")) {
    const executable = normalize(isAbsolute(command) ? command : resolve(cwd, command));
    return await isExecutable(executable, platform) ? { executable, source: "path" } : undefined;
  }

  const pathValue = environmentValue(env, "PATH", platform);
  if (pathValue === undefined) {
    return undefined;
  }
  const pathDelimiter = platform === "win32" ? ";" : delimiter;
  for (const directory of pathValue.split(pathDelimiter)) {
    const baseDirectory = directory.length === 0 ? cwd : directory;
    for (const executable of candidatePaths(baseDirectory, command, platform, env)) {
      if (await isExecutable(executable, platform)) {
        return { executable: normalize(executable), source: "path" };
      }
    }
  }
  return undefined;
}
