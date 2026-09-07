import assert from "node:assert/strict";
import test from "node:test";

import {
  createStubHarnessAdapter,
  evaluateProbePolicy,
  formatProbeWarnings,
  verifyCapabilities,
} from "../src/index.ts";

test("read-only probes are allowed by default and unsafe probes are denied", () => {
  assert.equal(evaluateProbePolicy({
    adapterId: "fixture",
    capability: "headless",
  }).allowed, true);

  const decision = evaluateProbePolicy({
    adapterId: "fixture",
    capability: "github-context",
    risks: ["external-access"],
    description: "secret=do-not-leak",
  });
  assert.equal(decision.allowed, false);
  assert.match(decision.reason, /external-access/);
  assert.doesNotMatch(formatProbeWarnings(decision), /do-not-leak|secret/);
});

test("mutating, paid, and model probes require their individual approvals", () => {
  assert.equal(evaluateProbePolicy({
    adapterId: "fixture",
    capability: "headless",
    risks: ["mutating"],
  }).allowed, false);
  assert.equal(evaluateProbePolicy({
    adapterId: "fixture",
    capability: "headless",
    risks: ["mutating"],
  }, { allowMutatingProbes: true }).allowed, true);
  assert.equal(evaluateProbePolicy({
    adapterId: "fixture",
    capability: "model-selection",
    risks: ["model-invoking"],
  }, { allowMutatingProbes: true }).allowed, false);
});

test("surfaces fixed warnings for external and potentially costly probes", () => {
  const decision = evaluateProbePolicy({
    adapterId: "fixture",
    capability: "model-selection",
    risks: ["external-access", "paid", "model-invoking"],
    description: "prompt=secret-token",
  });

  assert.deepEqual(decision.warnings, [
    "Probe may access an external service or network.",
    "Probe may incur provider or usage charges.",
    "Probe invokes a model and may send prompt or repository context.",
  ]);
  assert.doesNotMatch(formatProbeWarnings(decision), /secret-token|prompt=/);
});

test("policy rejection skips only unsafe capabilities and never invokes them", async () => {
  const adapter = createStubHarnessAdapter({ id: "fixture" });
  const run = await verifyCapabilities(adapter, ["headless", "github-context"], {
    risksByCapability: { "github-context": ["external-access"] },
  });
  assert.deepEqual(run.results.map((result) => [result.capability, result.status]), [
    ["headless", "passed"],
    ["github-context", "skipped"],
  ]);
  assert.deepEqual(adapter.calls.map((call) => call.operation), ["verify"]);
});

test("verification results retain warnings for both approved and rejected probes", async () => {
  const adapter = createStubHarnessAdapter({ id: "fixture" });
  const run = await verifyCapabilities(adapter, ["headless", "github-context"], {
    policy: { allowExternalAccess: true },
    risksByCapability: {
      headless: ["paid"],
      "github-context": ["external-access"],
    },
  });

  assert.deepEqual(run.warnings, [
    {
      capability: "headless",
      risks: ["paid"],
      messages: ["Probe may incur provider or usage charges."],
    },
    {
      capability: "github-context",
      risks: ["external-access"],
      messages: ["Probe may access an external service or network."],
    },
  ]);
});

test("passes the complete approved risk envelope to the adapter", async () => {
  let receivedContext;
  const adapter = {
    id: "fixture",
    supportedOperations: { discover: false, verify: true, execute: false, resume: false, fork: false },
    async verify(capabilities, context) {
      receivedContext = context;
      return capabilities.map((capability) => ({
        schemaVersion: 1,
        capability,
        status: "passed",
        startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
      }));
    },
  };

  await verifyCapabilities(adapter, ["headless", "github-context"], {
    policy: { allowExternalAccess: true },
    risksByCapability: { "github-context": ["external-access"] },
  });

  assert.deepEqual(receivedContext.probeRisks, ["read-only", "external-access"]);
});

test("bounds a hanging adapter probe and signals cancellation", async () => {
  let aborted = false;
  const adapter = {
    id: "fixture",
    supportedOperations: { discover: false, verify: true, execute: false, resume: false, fork: false },
    async verify(capabilities, context) {
      context.signal.addEventListener("abort", () => {
        aborted = true;
      }, { once: true });
      await new Promise(() => {});
      return capabilities.map((capability) => ({
        schemaVersion: 1,
        capability,
        status: "passed",
        startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
      }));
    },
  };

  const run = await verifyCapabilities(adapter, ["headless"], {
    context: { timeoutMs: 20 },
  });
  assert.deepEqual(run.results.map(({ capability, status, message }) => ({
    capability,
    status,
    message,
  })), [{
    capability: "headless",
    status: "timed-out",
    message: "Verification probe timed out after 20ms",
  }]);
  assert.equal(aborted, true);
});
