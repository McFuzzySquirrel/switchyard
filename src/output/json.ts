/**
 * Shared contract for public machine-readable command results.
 *
 * Command implementations own their payload fields, but every public JSON
 * result has the same versioned envelope. Keeping serialization here prevents
 * individual commands from accidentally diverging in formatting or omitting
 * the compatibility marker.
 */
export const COMMAND_SCHEMA_VERSION = 1 as const;

export interface VersionedCommandPayload {
  readonly schemaVersion: number;
  readonly command: string;
  readonly status: string;
}

export class JsonContractError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "JsonContractError";
  }
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertVersionedCommandPayload(
  payload: VersionedCommandPayload,
): void {
  if (!Number.isSafeInteger(payload.schemaVersion) || payload.schemaVersion < 1) {
    throw new JsonContractError("Command JSON schemaVersion must be a positive integer");
  }
  if (payload.command.length === 0) {
    throw new JsonContractError("Command JSON command must not be empty");
  }
  if (payload.status.length === 0) {
    throw new JsonContractError("Command JSON status must not be empty");
  }
}

/**
 * Serialize a command result without changing its public shape.
 *
 * Pretty-printing is intentional: it keeps captured CLI output readable while
 * remaining deterministic because command payloads are assembled in their
 * documented field order. The serializer does not add fields, so additive
 * schema evolution remains owned by the command contract.
 */
export function serializeCommandJson<T extends VersionedCommandPayload>(
  payload: T,
): string {
  assertVersionedCommandPayload(payload);
  const serialized = JSON.stringify(payload, null, 2);
  if (serialized === undefined) {
    throw new JsonContractError("Command result could not be serialized as JSON");
  }
  return serialized;
}

/**
 * Parse only the shared envelope. Command-specific consumers should validate
 * their own fields after this compatibility check.
 */
export function parseCommandJson(input: string): VersionedCommandPayload {
  let value: unknown;
  try {
    value = JSON.parse(input);
  } catch {
    throw new JsonContractError("Command output is not valid JSON");
  }

  if (!isRecord(value)) {
    throw new JsonContractError("Command JSON result must be an object");
  }
  if (typeof value.schemaVersion !== "number" ||
      !Number.isSafeInteger(value.schemaVersion) ||
      value.schemaVersion < 1) {
    throw new JsonContractError("Command JSON schemaVersion must be a positive integer");
  }
  if (typeof value.command !== "string" || value.command.length === 0) {
    throw new JsonContractError("Command JSON command must be a non-empty string");
  }
  if (typeof value.status !== "string" || value.status.length === 0) {
    throw new JsonContractError("Command JSON status must be a non-empty string");
  }
  return {
    schemaVersion: value.schemaVersion,
    command: value.command,
    status: value.status,
  };
}
