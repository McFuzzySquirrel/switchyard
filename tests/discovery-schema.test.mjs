import assert from "node:assert/strict";
import test from "node:test";
import {
  CAPABILITY_NAMES,
  CAPABILITY_VOCABULARY_VERSION,
  REQUIREMENTS_SCHEMA_VERSION,
  assertLocalRegistry,
  isCapabilityObservation,
  isJsonValue,
  normalizeCapabilityName,
  validateCapabilityObservation,
  validateHarnessProfile,
  validateLocalRegistry,
  validateProviderCapability,
  validateTaskRequirements,
} from "../src/index.ts";

const observedAt = "2026-09-07T19:00:00.000Z";

function observation(capability = "headless") {
  return {
    schemaVersion: 1,
    capability,
    discovery: {
      status: "observed",
      source: "help",
      observedAt,
      evidence: {
        source: "help",
        excerpt: "Usage: harness --non-interactive",
        capturedAt: observedAt,
        reference: "--help",
      },
    },
    verification: {
      status: "not-requested",
    },
  };
}

function profile(id, status = "available") {
  return {
    schemaVersion: 1,
    id,
    displayName: "Fixture Harness",
    executable: "/opt/fixture/harness",
    executableSource: "path",
    version: "1.2.3",
    capabilities: [observation()],
    status,
    lifecycle: status === "unavailable" ? "unavailable" : "registered",
    availability: {
      status,
      checkedAt: observedAt,
      ...(status === "unavailable" ? { reason: "executable was not found" } : {}),
    },
    discoveredAt: observedAt,
    updatedAt: observedAt,
  };
}

function providerCapability(id = "option:--model", kind = "option") {
  return {
    id,
    label: id,
    kind,
    observedAt,
    evidence: {
      source: "help",
      excerpt: "  --model <provider/model>",
      capturedAt: observedAt,
      reference: "--help",
    },
  };
}

test("normalizes documented and vendor aliases but rejects unknown capabilities", () => {
  assert.deepEqual(CAPABILITY_NAMES, [
    "headless",
    "model-selection",
    "continue",
    "fork",
    "mcp",
    "repository-access",
    "github-context",
    "parallel-execution",
    "local-models",
  ]);
  assert.equal(CAPABILITY_NAMES.length, 9);
  assert.equal(CAPABILITY_VOCABULARY_VERSION, "1.0");
  assert.equal(normalizeCapabilityName("  non interactive "), "headless");
  assert.equal(normalizeCapabilityName("resume"), "continue");
  assert.equal(normalizeCapabilityName("MODEL_SELECTION"), "model-selection");
  assert.equal(normalizeCapabilityName("resume") === "continue", true);
  assert.equal(normalizeCapabilityName("vendor-secret-feature"), undefined);
  assert.equal(normalizeCapabilityName(null), undefined);
});

test("keeps help discovery distinct from verification", () => {
  const result = validateCapabilityObservation(observation("repository-access"));
  assert.equal(result.success, true);
  if (result.success) {
    assert.equal(result.value.discovery.status, "observed");
    assert.equal(result.value.verification.status, "not-requested");
    assert.equal(result.value.verification.verifiedAt, undefined);
  }
  assert.equal(isCapabilityObservation(observation()), true);
});

test("accepts a complete verification record and requires its timestamp", () => {
  const verified = observation("mcp");
  verified.verification = {
    status: "passed",
    source: "probe",
    verifiedAt: observedAt,
    evidence: {
      source: "probe",
      excerpt: "read-only capability probe passed",
      capturedAt: observedAt,
    },
  };
  assert.equal(validateCapabilityObservation(verified).success, true);

  const incomplete = structuredClone(verified);
  delete incomplete.verification.verifiedAt;
  assert.equal(validateCapabilityObservation(incomplete).success, false);
});

test("rejects malformed observations and unsafe registry values", () => {
  const malformed = structuredClone(observation());
  malformed.capability = "not-in-vocabulary";
  assert.equal(validateCapabilityObservation(malformed).success, false);

  const missingEvidence = structuredClone(observation());
  delete missingEvidence.discovery.evidence;
  assert.equal(validateCapabilityObservation(missingEvidence).success, false);

  const unsafe = structuredClone(observation());
  unsafe.discovery.observedAt = "yesterday";
  assert.equal(validateCapabilityObservation(unsafe).success, false);

  const cyclic = observation();
  cyclic.discovery.evidence.loop = cyclic;
  assert.equal(validateCapabilityObservation(cyclic).success, false);

  const unknownField = observation();
  unknownField.extra = "typo";
  assert.equal(validateCapabilityObservation(unknownField).success, false);

  assert.equal(isJsonValue({ nested: ["safe", 1, null] }), true);
  assert.equal(isJsonValue({ value: Number.NaN }), false);
  assert.equal(isJsonValue(new Date()), false);
});

test("validates profiles, availability, lifecycle, and duplicate capability ids", () => {
  assert.equal(validateHarnessProfile(profile("fixture")).success, true);
  const withoutVersion = profile("versionless");
  delete withoutVersion.version;
  assert.equal(validateHarnessProfile(withoutVersion).success, true);
  assert.equal(validateHarnessProfile(profile("Fixture")).success, false);

  const inconsistent = profile("fixture");
  const invalidStatus = {
    ...inconsistent,
    status: "stale",
    availability: { ...inconsistent.availability, status: "available" },
  };
  assert.equal(validateHarnessProfile(invalidStatus).success, false);

  const duplicate = {
    ...inconsistent,
    capabilities: [observation(), observation()],
  };
  assert.equal(validateHarnessProfile(duplicate).success, false);
});

test("validates provider-specific capability inventory without expanding routing vocabulary", () => {
  const capability = providerCapability();
  assert.equal(validateProviderCapability(capability).success, true);

  const withInventory = {
    ...profile("fixture"),
    providerCapabilities: [
      capability,
      providerCapability("provider:ollama", "provider"),
      providerCapability("topic:providers", "topic"),
    ],
  };
  assert.equal(validateHarnessProfile(withInventory).success, true);

  const duplicate = {
    ...withInventory,
    providerCapabilities: [capability, capability],
  };
  assert.equal(validateHarnessProfile(duplicate).success, false);

  const invalidKind = providerCapability("command:run", "unknown");
  assert.equal(validateProviderCapability(invalidKind).success, false);

  const invalidId = providerCapability("Option:--model");
  assert.equal(validateProviderCapability(invalidId).success, false);

  const oversizedEvidence = providerCapability();
  oversizedEvidence.evidence.excerpt = "x".repeat(32769);
  assert.equal(validateProviderCapability(oversizedEvidence).success, false);
});

test("validates versioned local registries and preserves unavailable profiles", () => {
  const registry = {
    schemaVersion: 1,
    vocabularyVersion: CAPABILITY_VOCABULARY_VERSION,
    generatedAt: observedAt,
    updatedAt: observedAt,
    harnesses: [profile("available"), profile("missing", "unavailable")],
  };
  const result = validateLocalRegistry(registry);
  assert.equal(result.success, true);
  assert.equal(assertLocalRegistry(registry).harnesses.length, 2);

  const wrongVersion = { ...registry, schemaVersion: 99 };
  assert.equal(validateLocalRegistry(wrongVersion).success, false);
  const duplicateIds = { ...registry, harnesses: [profile("same"), profile("same")] };
  assert.equal(validateLocalRegistry(duplicateIds).success, false);
});

test("validates task requirements with optional schema version and rejects duplicates", () => {
  assert.equal(REQUIREMENTS_SCHEMA_VERSION, 1);
  assert.equal(
    validateTaskRequirements({
      requires: ["headless", "repository-access"],
      preferredHarness: "fixture",
      allowFallback: false,
    }).success,
    true,
  );
  assert.equal(
    validateTaskRequirements({
      schemaVersion: 1,
      requires: ["headless", "headless"],
    }).success,
    false,
  );
  assert.equal(
    validateTaskRequirements({
      schemaVersion: 2,
      requires: [],
    }).success,
    false,
  );
  assert.equal(
    validateTaskRequirements({
      schemaVersion: REQUIREMENTS_SCHEMA_VERSION,
      requires: ["headless"],
      preferredHarness: "Fixture",
    }).success,
    false,
  );
  assert.equal(
    validateTaskRequirements({
      requires: ["headless"],
      allowFallback: "yes",
    }).success,
    false,
  );
});
