import {
  CAPABILITY_VOCABULARY_VERSION,
  type CapabilityName,
  isCapabilityName,
} from "../capabilities/vocabulary.ts";

export type { CapabilityName } from "../capabilities/vocabulary.ts";

export const DISCOVERY_SCHEMA_VERSION = 1 as const;
export const REGISTRY_SCHEMA_VERSION = 1 as const;
export const REQUIREMENTS_SCHEMA_VERSION = 1 as const;

export type EvidenceSource =
  | "version"
  | "help"
  | "command"
  | "flag"
  | "documentation"
  | "probe"
  | "adapter";

export type DiscoveryStatus = "observed" | "not-observed" | "malformed";
export type VerificationStatus =
  | "not-requested"
  | "passed"
  | "failed"
  | "skipped"
  | "timed-out"
  | "unavailable";

export interface CapabilityEvidence {
  readonly source: EvidenceSource;
  /** A bounded, redacted excerpt or structured description; never executable. */
  readonly excerpt: string;
  readonly capturedAt: string;
  readonly reference?: string;
}

export interface DiscoveryObservation {
  readonly status: DiscoveryStatus;
  readonly source: EvidenceSource;
  readonly observedAt: string;
  readonly evidence?: CapabilityEvidence;
}

export interface VerificationObservation {
  readonly status: VerificationStatus;
  readonly verifiedAt?: string;
  readonly source?: EvidenceSource;
  readonly evidence?: CapabilityEvidence;
}

export interface CapabilityObservation {
  readonly schemaVersion: typeof DISCOVERY_SCHEMA_VERSION;
  readonly capability: CapabilityName;
  /**
   * Discovery and verification are intentionally separate. Help output can
   * establish `discovery.status === "observed"` but cannot establish a pass.
   */
  readonly discovery: DiscoveryObservation;
  readonly verification: VerificationObservation;
}

export type ProviderCapabilityKind = "command" | "option" | "provider" | "topic";

/**
 * Provider-specific feature evidence is preserved for inventory and diagnostics
 * without making every vendor label part of the routing vocabulary.
 */
export interface ProviderCapability {
  readonly id: string;
  readonly label: string;
  readonly kind: ProviderCapabilityKind;
  readonly observedAt: string;
  readonly evidence: CapabilityEvidence;
}

export type HarnessAvailability =
  | "available"
  | "unavailable"
  | "malformed"
  | "stale";

export type HarnessLifecycleState =
  | "unknown"
  | "discovered"
  | "verified"
  | "registered"
  | "eligible"
  | "selected"
  | "running"
  | "succeeded"
  | "failed"
  | "unavailable";

export type ExecutableSource = "override" | "path" | "configured";

export interface HarnessAvailabilityProfile {
  readonly status: HarnessAvailability;
  readonly checkedAt: string;
  readonly reason?: string;
}

export interface HarnessDiagnostic {
  readonly code: string;
  readonly message: string;
  readonly at: string;
}

export interface HarnessProfile {
  readonly schemaVersion: typeof DISCOVERY_SCHEMA_VERSION;
  readonly id: string;
  readonly displayName: string;
  /** Resolved executable path. It is data, never a shell command. */
  readonly executable: string;
  readonly executableSource: ExecutableSource;
  readonly version?: string;
  readonly capabilities: readonly CapabilityObservation[];
  readonly providerCapabilities?: readonly ProviderCapability[];
  readonly status: HarnessAvailability;
  readonly lifecycle: HarnessLifecycleState;
  readonly availability: HarnessAvailabilityProfile;
  readonly discoveredAt: string;
  readonly updatedAt: string;
  readonly lastVerifiedAt?: string;
  readonly diagnostics?: readonly HarnessDiagnostic[];
}

export interface LocalRegistry {
  readonly schemaVersion: typeof REGISTRY_SCHEMA_VERSION;
  readonly vocabularyVersion: typeof CAPABILITY_VOCABULARY_VERSION;
  readonly generatedAt: string;
  readonly updatedAt: string;
  readonly harnesses: readonly HarnessProfile[];
}

/** Compatibility alias for callers that refer to the persisted file as a registry. */
export type Registry = LocalRegistry;

export interface TaskRequirements {
  /** Optional for compatibility with the PRD's initial interface shape. */
  readonly schemaVersion?: typeof REQUIREMENTS_SCHEMA_VERSION;
  readonly requires: readonly CapabilityName[];
  readonly preferredHarness?: string;
  readonly allowFallback?: boolean;
}

export interface SchemaIssue {
  readonly path: string;
  readonly message: string;
}

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue =
  | JsonPrimitive
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue };

export type ValidationResult<T> =
  | { readonly success: true; readonly value: T; readonly issues: readonly [] }
  | { readonly success: false; readonly issues: readonly SchemaIssue[] };

export class SchemaValidationError extends Error {
  readonly issues: readonly SchemaIssue[];

  constructor(schema: string, issues: readonly SchemaIssue[]) {
    super(
      `${schema} validation failed: ${issues
        .map((issue) => `${issue.path} ${issue.message}`)
        .join("; ")}`,
    );
    this.name = "SchemaValidationError";
    this.issues = issues;
  }
}

const MAX_ID_LENGTH = 128;
const MAX_TEXT_LENGTH = 32768;
const MAX_REASON_LENGTH = 1024;
const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/;
const IDENTIFIER = /^[a-z0-9][a-z0-9._-]*$/;
const PROVIDER_CAPABILITY_ID = /^[a-z0-9][a-z0-9._:-]*$/;
const EVIDENCE_SOURCES: readonly EvidenceSource[] = [
  "version",
  "help",
  "command",
  "flag",
  "documentation",
  "probe",
  "adapter",
];
const DISCOVERY_STATUSES: readonly DiscoveryStatus[] = [
  "observed",
  "not-observed",
  "malformed",
];
const VERIFICATION_STATUSES: readonly VerificationStatus[] = [
  "not-requested",
  "passed",
  "failed",
  "skipped",
  "timed-out",
  "unavailable",
];
const AVAILABILITY_STATUSES: readonly HarnessAvailability[] = [
  "available",
  "unavailable",
  "malformed",
  "stale",
];
const LIFECYCLE_STATES: readonly HarnessLifecycleState[] = [
  "unknown",
  "discovered",
  "verified",
  "registered",
  "eligible",
  "selected",
  "running",
  "succeeded",
  "failed",
  "unavailable",
];
const EXECUTABLE_SOURCES: readonly ExecutableSource[] = [
  "override",
  "path",
  "configured",
];
const PROVIDER_CAPABILITY_KINDS: readonly ProviderCapabilityKind[] = [
  "command",
  "option",
  "provider",
  "topic",
];

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isJsonValue(
  value: unknown,
  seen = new Set<object>(),
): value is JsonValue {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return true;
  }
  if (typeof value === "number") {
    return Number.isFinite(value);
  }
  if (typeof value !== "object") {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null && !Array.isArray(value)) {
    return false;
  }
  if (seen.has(value)) {
    return false;
  }
  seen.add(value);
  const valid = Array.isArray(value)
    ? value.every((item) => isJsonValue(item, seen))
    : Object.values(value).every((item) => isJsonValue(item, seen));
  seen.delete(value);
  return valid;
}

function hasOnlyKeys(
  value: UnknownRecord,
  allowed: readonly string[],
  path: string,
  issues: SchemaIssue[],
): void {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) {
      issues.push({ path: `${path}.${key}`, message: "is not a recognized field" });
    }
  }
}

function requiredString(
  value: unknown,
  path: string,
  issues: SchemaIssue[],
  maxLength = MAX_TEXT_LENGTH,
): string | undefined {
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

function optionalString(
  value: unknown,
  path: string,
  issues: SchemaIssue[],
  maxLength = MAX_TEXT_LENGTH,
): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  return requiredString(value, path, issues, maxLength);
}

function timestamp(
  value: unknown,
  path: string,
  issues: SchemaIssue[],
): string | undefined {
  const text = requiredString(value, path, issues, 32);
  if (
    text === undefined ||
    !ISO_TIMESTAMP.test(text) ||
    !Number.isFinite(Date.parse(text))
  ) {
    if (typeof value === "string" && value.length > 0) {
      issues.push({ path, message: "must be a valid UTC ISO-8601 timestamp" });
    }
    return undefined;
  }
  return text;
}

function enumValue<T extends string>(
  value: unknown,
  values: readonly T[],
  path: string,
  issues: SchemaIssue[],
): T | undefined {
  if (typeof value !== "string" || !values.some((candidate) => candidate === value)) {
    issues.push({ path, message: `must be one of: ${values.join(", ")}` });
    return undefined;
  }
  return values.find((candidate) => candidate === value);
}

function schemaVersion(
  value: unknown,
  path: string,
  issues: SchemaIssue[],
): 1 | undefined {
  if (value !== DISCOVERY_SCHEMA_VERSION) {
    issues.push({ path, message: `must be schema version ${DISCOVERY_SCHEMA_VERSION}` });
    return undefined;
  }
  return DISCOVERY_SCHEMA_VERSION;
}

function requirementsSchemaVersion(
  value: unknown,
  path: string,
  issues: SchemaIssue[],
): typeof REQUIREMENTS_SCHEMA_VERSION | undefined {
  if (value !== REQUIREMENTS_SCHEMA_VERSION) {
    issues.push({
      path,
      message: `must be schema version ${REQUIREMENTS_SCHEMA_VERSION}`,
    });
    return undefined;
  }
  return REQUIREMENTS_SCHEMA_VERSION;
}

function validResult<T>(value: T): ValidationResult<T> {
  return { success: true, value, issues: [] };
}

function invalidResult<T>(issues: SchemaIssue[]): ValidationResult<T> {
  return { success: false, issues };
}

function validateEvidence(
  input: unknown,
  path: string,
): ValidationResult<CapabilityEvidence> {
  const issues: SchemaIssue[] = [];
  if (!isRecord(input)) {
    return invalidResult([{ path, message: "must be an object" }]);
  }
  hasOnlyKeys(input, ["source", "excerpt", "capturedAt", "reference"], path, issues);
  const source = enumValue(input.source, EVIDENCE_SOURCES, `${path}.source`, issues);
  const excerpt = requiredString(input.excerpt, `${path}.excerpt`, issues);
  const capturedAt = timestamp(input.capturedAt, `${path}.capturedAt`, issues);
  const reference = optionalString(input.reference, `${path}.reference`, issues, 512);
  if (issues.length > 0 || !source || !excerpt || !capturedAt) {
    return invalidResult(issues);
  }
  return validResult({
    source,
    excerpt,
    capturedAt,
    ...(reference === undefined ? {} : { reference }),
  });
}

function validateDiscoveryObservation(
  input: unknown,
  path: string,
): ValidationResult<DiscoveryObservation> {
  const issues: SchemaIssue[] = [];
  if (!isRecord(input)) {
    return invalidResult([{ path, message: "must be an object" }]);
  }
  hasOnlyKeys(input, ["status", "source", "observedAt", "evidence"], path, issues);
  const status = enumValue(
    input.status,
    DISCOVERY_STATUSES,
    `${path}.status`,
    issues,
  );
  const source = enumValue(input.source, EVIDENCE_SOURCES, `${path}.source`, issues);
  const observedAt = timestamp(input.observedAt, `${path}.observedAt`, issues);
  let evidence: CapabilityEvidence | undefined;
  if (input.evidence !== undefined) {
    const evidenceResult = validateEvidence(input.evidence, `${path}.evidence`);
    if (evidenceResult.success) {
      evidence = evidenceResult.value;
    } else {
      issues.push(...evidenceResult.issues);
    }
  } else if (input.status === "observed" || input.status === "malformed") {
    issues.push({ path: `${path}.evidence`, message: "is required for this status" });
  }
  if (issues.length > 0 || !status || !source || !observedAt) {
    return invalidResult(issues);
  }
  return validResult({
    status,
    source,
    observedAt,
    ...(evidence === undefined ? {} : { evidence }),
  });
}

function validateVerificationObservation(
  input: unknown,
  path: string,
): ValidationResult<VerificationObservation> {
  const issues: SchemaIssue[] = [];
  if (!isRecord(input)) {
    return invalidResult([{ path, message: "must be an object" }]);
  }
  hasOnlyKeys(input, ["status", "verifiedAt", "source", "evidence"], path, issues);
  const status = enumValue(
    input.status,
    VERIFICATION_STATUSES,
    `${path}.status`,
    issues,
  );
  const verifiedAt = input.verifiedAt === undefined
    ? undefined
    : timestamp(input.verifiedAt, `${path}.verifiedAt`, issues);
  const source = input.source === undefined
    ? undefined
    : enumValue(input.source, EVIDENCE_SOURCES, `${path}.source`, issues);
  let evidence: CapabilityEvidence | undefined;
  if (input.evidence !== undefined) {
    const evidenceResult = validateEvidence(input.evidence, `${path}.evidence`);
    if (evidenceResult.success) {
      evidence = evidenceResult.value;
    } else {
      issues.push(...evidenceResult.issues);
    }
  }
  if (
    input.status !== "not-requested" &&
    input.status !== "skipped" &&
    input.status !== undefined &&
    verifiedAt === undefined
  ) {
    issues.push({ path: `${path}.verifiedAt`, message: "is required after a verification attempt" });
  }
  if (input.status === "passed" && evidence === undefined) {
    issues.push({ path: `${path}.evidence`, message: "is required for a passed verification" });
  }
  if (issues.length > 0 || !status) {
    return invalidResult(issues);
  }
  return validResult({
    status,
    ...(verifiedAt === undefined ? {} : { verifiedAt }),
    ...(source === undefined ? {} : { source }),
    ...(evidence === undefined ? {} : { evidence }),
  });
}

export function validateCapabilityObservation(
  input: unknown,
): ValidationResult<CapabilityObservation> {
  const issues: SchemaIssue[] = [];
  if (!isJsonValue(input)) {
    return invalidResult([{ path: "$", message: "must contain JSON-safe values" }]);
  }
  if (!isRecord(input)) {
    return invalidResult([{ path: "$", message: "must be an object" }]);
  }
  hasOnlyKeys(input, ["schemaVersion", "capability", "discovery", "verification"], "$", issues);
  const version = schemaVersion(input.schemaVersion, "$.schemaVersion", issues);
  const capability = isCapabilityName(input.capability)
    ? input.capability
    : (issues.push({ path: "$.capability", message: "must be a normalized capability name" }), undefined);
  const discoveryResult = validateDiscoveryObservation(input.discovery, "$.discovery");
  const verificationResult = validateVerificationObservation(
    input.verification,
    "$.verification",
  );
  if (!discoveryResult.success) {
    issues.push(...discoveryResult.issues);
  }
  if (!verificationResult.success) {
    issues.push(...verificationResult.issues);
  }
  if (
    issues.length > 0 ||
    !version ||
    capability === undefined ||
    !discoveryResult.success ||
    !verificationResult.success
  ) {
    return invalidResult(issues);
  }
  return validResult({
    schemaVersion: version,
    capability,
    discovery: discoveryResult.value,
    verification: verificationResult.value,
  });
}

export function isCapabilityObservation(
  input: unknown,
): input is CapabilityObservation {
  return validateCapabilityObservation(input).success;
}

export function assertCapabilityObservation(
  input: unknown,
): CapabilityObservation {
  const result = validateCapabilityObservation(input);
  if (!result.success) {
    throw new SchemaValidationError("CapabilityObservation", result.issues);
  }
  return result.value;
}

function validateProviderCapabilityAtPath(
  input: unknown,
  path: string,
): ValidationResult<ProviderCapability> {
  const issues: SchemaIssue[] = [];
  if (!isRecord(input)) {
    return invalidResult([{ path, message: "must be an object" }]);
  }
  hasOnlyKeys(input, ["id", "label", "kind", "observedAt", "evidence"], path, issues);
  const id = requiredString(input.id, `${path}.id`, issues, MAX_ID_LENGTH);
  if (id && !PROVIDER_CAPABILITY_ID.test(id)) {
    issues.push({ path: `${path}.id`, message: "must use provider capability identifier characters" });
  }
  const label = requiredString(input.label, `${path}.label`, issues, 256);
  const kind = enumValue(
    input.kind,
    PROVIDER_CAPABILITY_KINDS,
    `${path}.kind`,
    issues,
  );
  const observedAt = timestamp(input.observedAt, `${path}.observedAt`, issues);
  const evidenceResult = validateEvidence(input.evidence, `${path}.evidence`);
  if (!evidenceResult.success) {
    issues.push(...evidenceResult.issues);
  }
  if (issues.length > 0 || !id || !label || !kind || !observedAt || !evidenceResult.success) {
    return invalidResult(issues);
  }
  return validResult({
    id,
    label,
    kind,
    observedAt,
    evidence: evidenceResult.value,
  });
}

export function validateProviderCapability(
  input: unknown,
): ValidationResult<ProviderCapability> {
  return validateProviderCapabilityAtPath(input, "$");
}

export function isProviderCapability(input: unknown): input is ProviderCapability {
  return validateProviderCapabilityAtPath(input, "$").success;
}

export function assertProviderCapability(input: unknown): ProviderCapability {
  const result = validateProviderCapabilityAtPath(input, "$");
  if (!result.success) {
    throw new SchemaValidationError("ProviderCapability", result.issues);
  }
  return result.value;
}

function validateDiagnostic(
  input: unknown,
  path: string,
): ValidationResult<HarnessDiagnostic> {
  const issues: SchemaIssue[] = [];
  if (!isRecord(input)) {
    return invalidResult([{ path, message: "must be an object" }]);
  }
  hasOnlyKeys(input, ["code", "message", "at"], path, issues);
  const code = requiredString(input.code, `${path}.code`, issues, 128);
  const message = requiredString(input.message, `${path}.message`, issues, MAX_REASON_LENGTH);
  const at = timestamp(input.at, `${path}.at`, issues);
  if (issues.length > 0 || !code || !message || !at) {
    return invalidResult(issues);
  }
  return validResult({ code, message, at });
}

export function validateHarnessProfile(
  input: unknown,
): ValidationResult<HarnessProfile> {
  const issues: SchemaIssue[] = [];
  if (!isJsonValue(input)) {
    return invalidResult([{ path: "$", message: "must contain JSON-safe values" }]);
  }
  if (!isRecord(input)) {
    return invalidResult([{ path: "$", message: "must be an object" }]);
  }
  hasOnlyKeys(
    input,
    [
      "schemaVersion",
      "id",
      "displayName",
      "executable",
      "executableSource",
      "version",
      "capabilities",
      "providerCapabilities",
      "status",
      "lifecycle",
      "availability",
      "discoveredAt",
      "updatedAt",
      "lastVerifiedAt",
      "diagnostics",
    ],
    "$",
    issues,
  );
  const version = schemaVersion(input.schemaVersion, "$.schemaVersion", issues);
  const id = requiredString(input.id, "$.id", issues, MAX_ID_LENGTH);
  if (id && !IDENTIFIER.test(id)) {
    issues.push({ path: "$.id", message: "must use lowercase identifier characters" });
  }
  const displayName = requiredString(input.displayName, "$.displayName", issues, 256);
  const executable = requiredString(input.executable, "$.executable", issues, 4096);
  const executableSource = enumValue(
    input.executableSource,
    EXECUTABLE_SOURCES,
    "$.executableSource",
    issues,
  );
  const profileStatus = enumValue(input.status, AVAILABILITY_STATUSES, "$.status", issues);
  const lifecycle = enumValue(
    input.lifecycle,
    LIFECYCLE_STATES,
    "$.lifecycle",
    issues,
  );
  const discoveredAt = timestamp(input.discoveredAt, "$.discoveredAt", issues);
  const updatedAt = timestamp(input.updatedAt, "$.updatedAt", issues);
  const lastVerifiedAt = input.lastVerifiedAt === undefined
    ? undefined
    : timestamp(input.lastVerifiedAt, "$.lastVerifiedAt", issues);
  const profileVersion = optionalString(input.version, "$.version", issues, 256);

  const availabilityInput = input.availability;
  let availability: HarnessAvailabilityProfile | undefined;
  if (!isRecord(availabilityInput)) {
    issues.push({ path: "$.availability", message: "must be an object" });
  } else {
    hasOnlyKeys(availabilityInput, ["status", "checkedAt", "reason"], "$.availability", issues);
    const availabilityStatus = enumValue(
      availabilityInput.status,
      AVAILABILITY_STATUSES,
      "$.availability.status",
      issues,
    );
    const checkedAt = timestamp(
      availabilityInput.checkedAt,
      "$.availability.checkedAt",
      issues,
    );
    const reason = optionalString(
      availabilityInput.reason,
      "$.availability.reason",
      issues,
      MAX_REASON_LENGTH,
    );
    if (availabilityStatus && profileStatus && availabilityStatus !== profileStatus) {
      issues.push({ path: "$.availability.status", message: "must match $.status" });
    }
    if (availabilityStatus && checkedAt) {
      availability = {
        status: availabilityStatus,
        checkedAt,
        ...(reason === undefined ? {} : { reason }),
      };
    }
  }

  let providerCapabilities: ProviderCapability[] | undefined;
  if (input.providerCapabilities !== undefined) {
    if (!Array.isArray(input.providerCapabilities)) {
      issues.push({ path: "$.providerCapabilities", message: "must be an array" });
    } else {
      providerCapabilities = [];
      const seenProviderCapabilities = new Set<string>();
      input.providerCapabilities.forEach((item, index) => {
        const result = validateProviderCapabilityAtPath(item, `$.providerCapabilities[${index}]`);
        if (!result.success) {
          issues.push(...result.issues);
        } else if (seenProviderCapabilities.has(result.value.id)) {
          issues.push({
            path: `$.providerCapabilities[${index}].id`,
            message: "must not duplicate another provider capability",
          });
        } else {
          seenProviderCapabilities.add(result.value.id);
          providerCapabilities?.push(result.value);
        }
      });
    }
  }

  const capabilitiesInput = input.capabilities;
  const capabilities: CapabilityObservation[] = [];
  if (!Array.isArray(capabilitiesInput)) {
    issues.push({ path: "$.capabilities", message: "must be an array" });
  } else {
    const seenCapabilities = new Set<CapabilityName>();
    capabilitiesInput.forEach((item, index) => {
      const result = validateCapabilityObservation(item);
      if (!result.success) {
        issues.push(
          ...result.issues.map((issue) => ({
            path: `$.capabilities[${index}]${issue.path.slice(1)}`,
            message: issue.message,
          })),
        );
      } else if (seenCapabilities.has(result.value.capability)) {
        issues.push({
          path: `$.capabilities[${index}].capability`,
          message: "must not duplicate another capability",
        });
      } else {
        seenCapabilities.add(result.value.capability);
        capabilities.push(result.value);
      }
    });
  }

  let diagnostics: HarnessDiagnostic[] | undefined;
  if (input.diagnostics !== undefined) {
    if (!Array.isArray(input.diagnostics)) {
      issues.push({ path: "$.diagnostics", message: "must be an array" });
    } else {
      diagnostics = [];
      input.diagnostics.forEach((item, index) => {
        const result = validateDiagnostic(item, `$.diagnostics[${index}]`);
        if (result.success) {
          diagnostics?.push(result.value);
        } else {
          issues.push(...result.issues);
        }
      });
    }
  }

  if (
    profileStatus === "unavailable" &&
    lifecycle !== undefined &&
    lifecycle !== "unavailable"
  ) {
    issues.push({ path: "$.lifecycle", message: "must be unavailable when profile status is unavailable" });
  }
  if (
    lifecycle === "unavailable" &&
    profileStatus !== undefined &&
    profileStatus !== "unavailable"
  ) {
    issues.push({ path: "$.status", message: "must be unavailable when lifecycle is unavailable" });
  }
  if (
    issues.length > 0 ||
    !version ||
    !id ||
    !displayName ||
    !executable ||
    !executableSource ||
    !profileStatus ||
    !lifecycle ||
    !discoveredAt ||
    !updatedAt ||
    !availability
  ) {
    return invalidResult(issues);
  }
  return validResult({
    schemaVersion: version,
    id,
    displayName,
    executable,
    executableSource,
    ...(profileVersion === undefined ? {} : { version: profileVersion }),
    capabilities,
    ...(providerCapabilities === undefined ? {} : { providerCapabilities }),
    status: profileStatus,
    lifecycle,
    availability,
    discoveredAt,
    updatedAt,
    ...(lastVerifiedAt === undefined ? {} : { lastVerifiedAt }),
    ...(diagnostics === undefined ? {} : { diagnostics }),
  });
}

export function isHarnessProfile(input: unknown): input is HarnessProfile {
  return validateHarnessProfile(input).success;
}

export function assertHarnessProfile(input: unknown): HarnessProfile {
  const result = validateHarnessProfile(input);
  if (!result.success) {
    throw new SchemaValidationError("HarnessProfile", result.issues);
  }
  return result.value;
}

export function validateLocalRegistry(
  input: unknown,
): ValidationResult<LocalRegistry> {
  const issues: SchemaIssue[] = [];
  if (!isJsonValue(input)) {
    return invalidResult([{ path: "$", message: "must contain JSON-safe values" }]);
  }
  if (!isRecord(input)) {
    return invalidResult([{ path: "$", message: "must be an object" }]);
  }
  hasOnlyKeys(
    input,
    ["schemaVersion", "vocabularyVersion", "generatedAt", "updatedAt", "harnesses"],
    "$",
    issues,
  );
  const version = schemaVersion(input.schemaVersion, "$.schemaVersion", issues);
  if (input.vocabularyVersion !== CAPABILITY_VOCABULARY_VERSION) {
    issues.push({
      path: "$.vocabularyVersion",
      message: `must be vocabulary version ${CAPABILITY_VOCABULARY_VERSION}`,
    });
  }
  const generatedAt = timestamp(input.generatedAt, "$.generatedAt", issues);
  const updatedAt = timestamp(input.updatedAt, "$.updatedAt", issues);
  const harnesses: HarnessProfile[] = [];
  if (!Array.isArray(input.harnesses)) {
    issues.push({ path: "$.harnesses", message: "must be an array" });
  } else {
    const ids = new Set<string>();
    input.harnesses.forEach((item, index) => {
      const result = validateHarnessProfile(item);
      if (!result.success) {
        issues.push(
          ...result.issues.map((issue) => ({
            path: `$.harnesses[${index}]${issue.path.slice(1)}`,
            message: issue.message,
          })),
        );
      } else if (ids.has(result.value.id)) {
        issues.push({
          path: `$.harnesses[${index}].id`,
          message: "must not duplicate another harness id",
        });
      } else {
        ids.add(result.value.id);
        harnesses.push(result.value);
      }
    });
  }
  if (
    issues.length > 0 ||
    !version ||
    !generatedAt ||
    !updatedAt ||
    input.vocabularyVersion !== CAPABILITY_VOCABULARY_VERSION
  ) {
    return invalidResult(issues);
  }
  return validResult({
    schemaVersion: version,
    vocabularyVersion: CAPABILITY_VOCABULARY_VERSION,
    generatedAt,
    updatedAt,
    harnesses,
  });
}

export function isLocalRegistry(input: unknown): input is LocalRegistry {
  return validateLocalRegistry(input).success;
}

export function assertLocalRegistry(input: unknown): LocalRegistry {
  const result = validateLocalRegistry(input);
  if (!result.success) {
    throw new SchemaValidationError("LocalRegistry", result.issues);
  }
  return result.value;
}

export function validateTaskRequirements(
  input: unknown,
): ValidationResult<TaskRequirements> {
  const issues: SchemaIssue[] = [];
  if (!isJsonValue(input)) {
    return invalidResult([{ path: "$", message: "must contain JSON-safe values" }]);
  }
  if (!isRecord(input)) {
    return invalidResult([{ path: "$", message: "must be an object" }]);
  }
  hasOnlyKeys(input, ["schemaVersion", "requires", "preferredHarness", "allowFallback"], "$", issues);
  if (input.schemaVersion !== undefined) {
    requirementsSchemaVersion(input.schemaVersion, "$.schemaVersion", issues);
  }
  const requires: CapabilityName[] = [];
  if (!Array.isArray(input.requires)) {
    issues.push({ path: "$.requires", message: "must be an array" });
  } else {
    const seen = new Set<CapabilityName>();
    input.requires.forEach((item, index) => {
      if (!isCapabilityName(item)) {
        issues.push({
          path: `$.requires[${index}]`,
          message: "must be a normalized capability name",
        });
      } else if (seen.has(item)) {
        issues.push({
          path: `$.requires[${index}]`,
          message: "must not duplicate another requirement",
        });
      } else {
        seen.add(item);
        requires.push(item);
      }
    });
  }
  const preferredHarness = optionalString(
    input.preferredHarness,
    "$.preferredHarness",
    issues,
    MAX_ID_LENGTH,
  );
  if (preferredHarness !== undefined && !IDENTIFIER.test(preferredHarness)) {
    issues.push({
      path: "$.preferredHarness",
      message: "must use lowercase identifier characters",
    });
  }
  if (
    input.allowFallback !== undefined &&
    typeof input.allowFallback !== "boolean"
  ) {
    issues.push({ path: "$.allowFallback", message: "must be a boolean" });
  }
  const allowFallback =
    typeof input.allowFallback === "boolean" ? input.allowFallback : undefined;
  if (issues.length > 0) {
    return invalidResult(issues);
  }
  return validResult({
    ...(input.schemaVersion === undefined
      ? {}
      : { schemaVersion: REQUIREMENTS_SCHEMA_VERSION }),
    requires,
    ...(preferredHarness === undefined ? {} : { preferredHarness }),
    ...(allowFallback === undefined ? {} : { allowFallback }),
  });
}

export function isTaskRequirements(input: unknown): input is TaskRequirements {
  return validateTaskRequirements(input).success;
}

export function assertTaskRequirements(input: unknown): TaskRequirements {
  const result = validateTaskRequirements(input);
  if (!result.success) {
    throw new SchemaValidationError("TaskRequirements", result.issues);
  }
  return result.value;
}
