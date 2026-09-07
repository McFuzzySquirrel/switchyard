/**
 * Registry persistence is intentionally not implemented in this module yet.
 * Keeping the public schema here gives atomic readers/writers one stable,
 * versioned contract without coupling them to filesystem mechanics.
 */
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
