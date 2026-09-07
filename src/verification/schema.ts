import {
  isCapabilityName,
  type CapabilityName,
} from "../capabilities/vocabulary.ts";

export const VERIFICATION_RESULT_SCHEMA_VERSION = 1 as const;

export type VerificationResultStatus =
  | "passed"
  | "failed"
  | "skipped"
  | "timed-out"
  | "unavailable";

export interface VerificationResult {
  readonly schemaVersion: typeof VERIFICATION_RESULT_SCHEMA_VERSION;
  readonly capability: CapabilityName;
  readonly status: VerificationResultStatus;
  readonly startedAt: string;
  readonly completedAt: string;
  readonly message?: string;
}

export interface VerificationResultSchemaIssue {
  readonly path: string;
  readonly message: string;
}

export type VerificationResultValidationResult =
  | {
      readonly success: true;
      readonly value: VerificationResult;
      readonly issues: readonly [];
    }
  | {
      readonly success: false;
      readonly issues: readonly VerificationResultSchemaIssue[];
    };

const STATUSES: readonly VerificationResultStatus[] = [
  "passed",
  "failed",
  "skipped",
  "timed-out",
  "unavailable",
];
const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function timestamp(
  value: unknown,
  path: string,
  issues: VerificationResultSchemaIssue[],
): string | undefined {
  if (
    typeof value !== "string" ||
    !ISO_TIMESTAMP.test(value) ||
    !Number.isFinite(Date.parse(value))
  ) {
    issues.push({ path, message: "must be a valid UTC ISO-8601 timestamp" });
    return undefined;
  }
  return value;
}

export function validateVerificationResult(
  input: unknown,
): VerificationResultValidationResult {
  const issues: VerificationResultSchemaIssue[] = [];
  if (!isRecord(input)) {
    return { success: false, issues: [{ path: "$", message: "must be an object" }] };
  }

  for (const key of Object.keys(input)) {
    if (!["schemaVersion", "capability", "status", "startedAt", "completedAt", "message"].includes(key)) {
      issues.push({ path: `$.${key}`, message: "is not allowed" });
    }
  }
  if (input.schemaVersion !== VERIFICATION_RESULT_SCHEMA_VERSION) {
    issues.push({
      path: "$.schemaVersion",
      message: `must be schema version ${VERIFICATION_RESULT_SCHEMA_VERSION}`,
    });
  }
  if (!isCapabilityName(input.capability)) {
    issues.push({ path: "$.capability", message: "must be a normalized capability name" });
  }
  if (typeof input.status !== "string" || !STATUSES.includes(input.status as VerificationResultStatus)) {
    issues.push({ path: "$.status", message: `must be one of: ${STATUSES.join(", ")}` });
  }
  const startedAt = timestamp(input.startedAt, "$.startedAt", issues);
  const completedAt = timestamp(input.completedAt, "$.completedAt", issues);
  if (startedAt && completedAt && Date.parse(completedAt) < Date.parse(startedAt)) {
    issues.push({ path: "$.completedAt", message: "must not be before startedAt" });
  }
  if (input.message !== undefined && (
    typeof input.message !== "string" ||
    input.message.length > 4096
  )) {
    issues.push({
      path: "$.message",
      message: "must be a string of at most 4096 characters when provided",
    });
  }
  const message = typeof input.message === "string" ? input.message : undefined;

  if (issues.length > 0 || !isCapabilityName(input.capability) || !startedAt || !completedAt) {
    return { success: false, issues };
  }
  return {
    success: true,
    value: {
      schemaVersion: VERIFICATION_RESULT_SCHEMA_VERSION,
      capability: input.capability,
      status: input.status as VerificationResultStatus,
      startedAt,
      completedAt,
      ...(message === undefined ? {} : { message }),
    },
    issues: [],
  };
}

export function isVerificationResult(input: unknown): input is VerificationResult {
  return validateVerificationResult(input).success;
}

export function assertVerificationResult(input: unknown): VerificationResult {
  const result = validateVerificationResult(input);
  if (!result.success) {
    throw new Error(
      `VerificationResult validation failed: ${result.issues
        .map((issue) => `${issue.path} ${issue.message}`)
        .join("; ")}`,
    );
  }
  return result.value;
}
