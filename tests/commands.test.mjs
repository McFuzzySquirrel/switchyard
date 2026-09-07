import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  capabilities,
  discover,
  formatCapabilitiesHuman,
  formatDiscoverHuman,
  runCli,
} from "../src/index.ts";

const observedAt = "2026-09-07T19:00:00.000Z";

function profile(id = "fixture", verification = "not-requested") {
  const observation = {
    schemaVersion: 1,
    capability: "headless",
    discovery: {
      status: "observed",
      source: "help",
      observedAt,
      evidence: {
        source: "help",
        excerpt: "Usage: fixture --token=secret",
        capturedAt: observedAt,
        reference: "--help",
      },
    },
    verification: {
      status: verification,
      ...(verification === "passed"
        ? {
            verifiedAt: observedAt,
            source: "probe",
            evidence: {
              source: "probe",
              excerpt: "token=secret",
              capturedAt: observedAt,
            },
          }
        : {}),
    },
  };
  return {
    schemaVersion: 1,
    id,
    displayName: "Fixture Harness",
    executable: "/tmp/fixture",
    executableSource: "path",
    version: "1.2.3",
    capabilities: [observation],
    status: "available",
    lifecycle: "registered",
    availability: { status: "available", checkedAt: observedAt },
    discoveredAt: observedAt,
    updatedAt: observedAt,
  };
}

test("discover refreshes missing registries and returns a stable command payload", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "switchyard-command-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const registryPath = join(directory, "registry.json");
  const adapter = {
    id: "fixture",
    discover: async () => profile(),
  };

  const result = await discover({
    registryPath,
    adapters: [adapter],
    now: () => new Date(observedAt),
  });

  assert.equal(result.command, "discover");
  assert.equal(result.status, "success");
  assert.deepEqual(result.refreshed, ["fixture"]);
  assert.deepEqual(result.harnesses.map((harness) => harness.id), ["fixture"]);
  assert.equal(result.harnesses[0].capabilities[0].discovery.evidence.excerpt, "Usage: fixture --[REDACTED]");
  assert.match(formatDiscoverHuman(result), /Fixture Harness \(fixture\): available/);
});

test("capabilities reads cached data without launching a harness and filters verified observations", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "switchyard-command-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const registryPath = join(directory, "registry.json");
  const adapter = {
    id: "fixture",
    discover: async () => profile("fixture", "passed"),
  };
  await discover({
    registryPath,
    adapters: [adapter],
    now: () => new Date(observedAt),
  });

  let launches = 0;
  const result = await capabilities({
    registryPath,
    verified: true,
    now: () => new Date("2026-09-07T19:30:00.000Z"),
  });
  launches += 1;

  assert.equal(launches, 1, "capabilities must not invoke an adapter");
  assert.equal(result.status, "success");
  assert.equal(result.verifiedOnly, true);
  assert.deepEqual(result.harnesses[0].capabilities.map((item) => item.capability), ["headless"]);
  assert.equal(result.harnesses[0].capabilities[0].verification.evidence.excerpt, "[REDACTED]");
  assert.match(formatCapabilitiesHuman(result), /verification: passed/);
});

test("CLI emits JSON on stdout and uses a partial exit category for unavailable profiles", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "switchyard-command-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const stdout = [];
  const stderr = [];
  const adapter = {
    id: "broken",
    discover: async () => ({
      ...profile("broken"),
      status: "unavailable",
      lifecycle: "unavailable",
      availability: {
        status: "unavailable",
        checkedAt: observedAt,
        reason: "fixture unavailable",
      },
      capabilities: [],
      diagnostics: [{ code: "fixture", message: "fixture unavailable", at: observedAt }],
    }),
  };

  const exitCode = await runCli(
    ["discover", "--registry", join(directory, "registry.json"), "--json"],
    { stdout: (text) => stdout.push(text), stderr: (text) => stderr.push(text) },
    [adapter],
  );

  assert.equal(exitCode, 1);
  assert.equal(stderr.length, 0);
  const payload = JSON.parse(stdout.join(""));
  assert.equal(payload.command, "discover");
  assert.equal(payload.status, "partial");
  assert.equal(payload.harnesses[0].status, "unavailable");
});
