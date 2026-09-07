import { randomUUID } from "node:crypto";
import {
  mkdir,
  open,
  readFile,
  rename,
  rm,
} from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import {
  assertLocalRegistry,
  DISCOVERY_SCHEMA_VERSION,
  REGISTRY_SCHEMA_VERSION,
  SchemaValidationError,
} from "./schema.ts";

import type {
  CapabilityEvidence,
  CapabilityObservation,
  DiscoveryObservation,
  DiscoveryStatus,
  EvidenceSource,
  ExecutableSource,
  HarnessAvailability,
  HarnessAvailabilityProfile,
  HarnessDiagnostic,
  HarnessLifecycleState,
  HarnessProfile,
  JsonPrimitive,
  JsonValue,
  LocalRegistry,
  Registry,
  SchemaIssue,
  TaskRequirements,
  ValidationResult,
  VerificationObservation,
  VerificationStatus,
} from "./schema.ts";

export {
  DISCOVERY_SCHEMA_VERSION,
  REGISTRY_SCHEMA_VERSION,
  SchemaValidationError,
  assertCapabilityObservation,
  assertHarnessProfile,
  assertLocalRegistry,
  assertTaskRequirements,
  isCapabilityObservation,
  isHarnessProfile,
  isLocalRegistry,
  isTaskRequirements,
  isJsonValue,
  validateCapabilityObservation,
  validateHarnessProfile,
  validateLocalRegistry,
  validateTaskRequirements,
} from "./schema.ts";

export type {
  CapabilityEvidence,
  CapabilityObservation,
  DiscoveryObservation,
  DiscoveryStatus,
  ExecutableSource,
  HarnessAvailability,
  HarnessAvailabilityProfile,
  HarnessDiagnostic,
  HarnessLifecycleState,
  HarnessProfile,
  JsonPrimitive,
  JsonValue,
  LocalRegistry,
  Registry,
  SchemaIssue,
  TaskRequirements,
  ValidationResult,
  VerificationObservation,
  VerificationStatus,
  EvidenceSource,
} from "./schema.ts";

export type RegistryPath = string | URL;

export interface RegistryReadOptions {
  /**
   * A missing registry is normal before the first discovery. Set this to
   * false when callers need a missing file to be reported as an error.
   */
  readonly allowMissing?: boolean;
}

export interface RegistryWriteOptions {
  /** File permissions for newly-created registry files. */
  readonly fileMode?: number;
  /** Directory permissions when the registry parent does not exist. */
  readonly directoryMode?: number;
}

export type RegistryPersistenceErrorCode =
  | "invalid-path"
  | "not-found"
  | "invalid-json"
  | "invalid-schema"
  | "read-failed"
  | "write-failed";

/**
 * Error raised when a registry cannot be safely loaded or persisted.
 *
 * The error never includes registry contents. Schema issues are retained as
 * structured data so a caller can present actionable diagnostics without
 * executing or interpolating the JSON.
 */
export class RegistryPersistenceError extends Error {
  readonly code: RegistryPersistenceErrorCode;
  readonly path: string;
  readonly issues: readonly SchemaIssue[];
  readonly cause?: unknown;

  constructor(
    code: RegistryPersistenceErrorCode,
    path: string,
    message: string,
    options: { readonly issues?: readonly SchemaIssue[]; readonly cause?: unknown } = {},
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "RegistryPersistenceError";
    this.code = code;
    this.path = path;
    this.issues = options.issues ?? [];
    this.cause = options.cause;
  }
}

const DEFAULT_FILE_MODE = 0o600;
const DEFAULT_DIRECTORY_MODE = 0o700;
const WINDOWS_REPLACEMENT_RETRIES = 4;
const WINDOWS_REPLACEMENT_DELAY_MS = 25;

function pathString(registryPath: RegistryPath): string {
  if (registryPath instanceof URL) {
    if (registryPath.protocol !== "file:") {
      throw new RegistryPersistenceError(
        "invalid-path",
        registryPath.toString(),
        "Registry path must be a local file URL",
      );
    }
    return resolve(fileURLToPath(registryPath));
  }
  if (typeof registryPath !== "string" || registryPath.length === 0 || registryPath.includes("\u0000")) {
    throw new RegistryPersistenceError(
      "invalid-path",
      typeof registryPath === "string" ? registryPath : String(registryPath),
      "Registry path must be a non-empty local path without NUL characters",
    );
  }
  return resolve(registryPath);
}

function isFileSystemError(error: unknown, code: string): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === code
  );
}

function isWindowsReplacementError(error: unknown): boolean {
  return (
    isFileSystemError(error, "EEXIST") ||
    isFileSystemError(error, "EPERM") ||
    isFileSystemError(error, "ENOTEMPTY")
  );
}

function isUnsupportedDirectorySyncError(error: unknown): boolean {
  return (
    isFileSystemError(error, "EINVAL") ||
    isFileSystemError(error, "ENOTSUP") ||
    isFileSystemError(error, "EISDIR") ||
    isFileSystemError(error, "EPERM")
  );
}

function temporaryPath(targetPath: string): string {
  return `${targetPath}.${process.pid}.${randomUUID()}.tmp`;
}

function backupPath(targetPath: string): string {
  return `${targetPath}.backup`;
}

async function syncDirectory(directoryPath: string): Promise<void> {
  let directory: Awaited<ReturnType<typeof open>> | undefined;
  try {
    directory = await open(directoryPath, "r");
    await directory.sync();
  } catch (error: unknown) {
    // Directory fsync is not available on every supported filesystem (notably
    // some Windows filesystems). The file itself has already been fsynced.
    if (!isUnsupportedDirectorySyncError(error)) {
      throw error;
    }
  } finally {
    if (directory !== undefined) {
      await directory.close().catch(() => undefined);
    }
  }
}

/**
 * Replace a registry file without ever truncating the current target.
 *
 * POSIX rename is an atomic replacement. Node's Windows implementation can
 * reject replacement while another process has the target open, so retry that
 * operation and then use a recoverable backup sequence as a last resort.
 * `readRegistry` repairs the backup if a process is interrupted between the
 * two Windows renames.
 */
async function replaceRegistryFile(
  temporary: string,
  target: string,
): Promise<void> {
  try {
    await rename(temporary, target);
    return;
  } catch (error: unknown) {
    if (process.platform !== "win32" || !isWindowsReplacementError(error)) {
      throw error;
    }
  }

  for (let attempt = 0; attempt < WINDOWS_REPLACEMENT_RETRIES; attempt += 1) {
    await new Promise((resolveDelay) =>
      setTimeout(resolveDelay, WINDOWS_REPLACEMENT_DELAY_MS),
    );
    try {
      await rename(temporary, target);
      return;
    } catch (error: unknown) {
      if (!isWindowsReplacementError(error) || attempt === WINDOWS_REPLACEMENT_RETRIES - 1) {
        break;
      }
    }
  }

  const backup = backupPath(target);
  let movedExisting = false;
  try {
    await rename(target, backup);
    movedExisting = true;
  } catch (error: unknown) {
    if (!isFileSystemError(error, "ENOENT")) {
      throw error;
    }
  }

  try {
    await rename(temporary, target);
  } catch (error: unknown) {
    if (movedExisting) {
      await rename(backup, target).catch(() => undefined);
    }
    throw error;
  }

  if (movedExisting) {
    // Cleanup is not part of the replacement itself. If a scanner still has
    // the backup open, leave it for a later write/recovery pass rather than
    // reporting a failed write after the new target is already in place.
    await rm(backup, { force: true }).catch(() => undefined);
  }
}

async function recoverInterruptedReplacement(target: string): Promise<void> {
  const backup = backupPath(target);
  try {
    const handle = await open(target, "r");
    await handle.close();
    return;
  } catch (error: unknown) {
    if (!isFileSystemError(error, "ENOENT")) {
      return;
    }
  }

  try {
    await rename(backup, target);
  } catch (error: unknown) {
    // A backup is optional. Preserve the original read error when neither
    // target nor backup is available.
    if (!isFileSystemError(error, "ENOENT")) {
      return;
    }
  }
}

function persistenceError(
  code: RegistryPersistenceErrorCode,
  target: string,
  message: string,
  cause?: unknown,
  issues?: readonly SchemaIssue[],
): RegistryPersistenceError {
  return new RegistryPersistenceError(code, target, message, { cause, issues });
}

/**
 * Reads and validates a registry snapshot. A writer only replaces the target
 * after its complete JSON payload has been written and synced, so readers see
 * either the previous valid snapshot or the new one, never a partial file.
 */
export async function readRegistry(
  registryPath: RegistryPath,
  options: RegistryReadOptions = {},
): Promise<LocalRegistry | undefined> {
  let target: string;
  try {
    target = pathString(registryPath);
  } catch (error: unknown) {
    throw error;
  }

  await recoverInterruptedReplacement(target);

  let contents: string;
  try {
    contents = await readFile(target, "utf8");
  } catch (error: unknown) {
    if (isFileSystemError(error, "ENOENT") && options.allowMissing !== false) {
      return undefined;
    }
    throw persistenceError(
      isFileSystemError(error, "ENOENT") ? "not-found" : "read-failed",
      target,
      isFileSystemError(error, "ENOENT")
        ? "Registry file does not exist"
        : "Registry file could not be read",
      error,
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(contents) as unknown;
  } catch (error: unknown) {
    throw persistenceError(
      "invalid-json",
      target,
      "Registry file contains invalid JSON",
      error,
    );
  }

  try {
    return assertLocalRegistry(parsed);
  } catch (error: unknown) {
    if (error instanceof SchemaValidationError) {
      throw persistenceError(
        "invalid-schema",
        target,
        "Registry file does not match the supported registry schema",
        error,
        error.issues,
      );
    }
    throw persistenceError(
      "invalid-schema",
      target,
      "Registry file could not be validated",
      error,
    );
  }
}

/**
 * Persists a validated registry using a same-directory temporary file,
 * fsync, and replacement. Failed writes clean up only their temporary file
 * and leave the previous registry untouched.
 */
export async function writeRegistry(
  registryPath: RegistryPath,
  registry: LocalRegistry,
  options: RegistryWriteOptions = {},
): Promise<void> {
  const target = pathString(registryPath);
  const validated = assertLocalRegistry(registry);
  const directory = dirname(target);
  const temporary = temporaryPath(target);
  let temporaryCreated = false;
  let replaced = false;

  try {
    await mkdir(directory, {
      recursive: true,
      mode: options.directoryMode ?? DEFAULT_DIRECTORY_MODE,
    });
    const handle = await open(
      temporary,
      "wx",
      options.fileMode ?? DEFAULT_FILE_MODE,
    );
    temporaryCreated = true;
    try {
      await handle.writeFile(`${JSON.stringify(validated, null, 2)}\n`, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }

    await replaceRegistryFile(temporary, target);
    replaced = true;
    await syncDirectory(directory);
  } catch (error: unknown) {
    throw persistenceError(
      "write-failed",
      target,
      "Registry file could not be written atomically",
      error,
    );
  } finally {
    if (temporaryCreated && !replaced) {
      await rm(temporary, { force: true }).catch(() => undefined);
    }
  }
}

/**
 * Strict read variant for callers where a missing registry is an error.
 */
export async function loadRegistry(registryPath: RegistryPath): Promise<LocalRegistry> {
  const registry = await readRegistry(registryPath, { allowMissing: false });
  if (registry === undefined) {
    throw new RegistryPersistenceError(
      "not-found",
      pathString(registryPath),
      "Registry file does not exist",
    );
  }
  return registry;
}

export const readLocalRegistry = readRegistry;
export const writeLocalRegistry = writeRegistry;
export const saveRegistry = writeRegistry;
