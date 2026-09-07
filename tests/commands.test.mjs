import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import test from "node:test";

import {
  capabilities,
  formatCapabilitiesJson,
  discover,
  formatDiscoverJson,
  formatCapabilitiesHuman,
  formatDiscoverHuman,
  explain,
  formatExplainJson,
  formatExplainHuman,
  parseCommandJson,
  parseDecisionJson,
  serializeCommandJson,
  DECISION_SCHEMA_VERSION,
  runCli,
} from "../src/index.ts";

const observedAt = "2026-09-07T19:00:00.000Z";
const execFileAsync = promisify(execFile);

function profile(id = "fixture", verification = "not-requested", capabilityNames = ["headless"]) {
  const observations = capabilityNames.map((capability) => ({
    schemaVersion: 1,
    capability,
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
  }));
  return {
    schemaVersion: 1,
    id,
    displayName: "Fixture Harness",
    executable: "/tmp/fixture",
    executableSource: "path",
    version: "1.2.3",
    capabilities: observations,
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
  const json = JSON.parse(formatDiscoverJson(result));
  assert.equal(json.schemaVersion, 1);
  assert.equal(json.harnesses[0].capabilities[0].discovery.evidence.excerpt, "Usage: fixture --[REDACTED]");
});

test("discover loads the local adapter config and applies per-harness environment overrides", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "switchyard-configured-command-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const configPath = join(directory, "config.json");
  const registryPath = join(directory, "registry.json");
  await writeFile(
    configPath,
    JSON.stringify({
      schemaVersion: 1,
      registryPath,
      probePolicy: { timeoutMs: 3000, maxOutputLength: 2048 },
      harnesses: { fixture: { executable: "/config/fixture" } },
    }),
  );

  let received;
  const adapter = {
    id: "fixture",
    discover: async (options) => {
      received = options;
      return profile();
    },
  };

  await discover({
    configPath,
    adapters: [adapter],
    env: {
      SWITCHYARD_FIXTURE_EXECUTABLE: "/env/fixture",
      SWITCHYARD_FIXTURE_PROBE_TIMEOUT_MS: "9000",
    },
    now: () => new Date(observedAt),
  });

  assert.equal(received.executable, "/env/fixture");
  assert.equal(received.configuredExecutable, "/config/fixture");
  assert.equal(received.timeoutMs, 9000);
  assert.equal(received.maxOutputLength, 2048);
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
  const json = JSON.parse(formatCapabilitiesJson(result));
  assert.equal(json.command, "capabilities");
  assert.equal(json.harnesses[0].capabilities[0].verification.evidence.excerpt, "[REDACTED]");
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

test("explain-specific options remain invalid for existing commands", async () => {
  const stderr = [];
  const exitCode = await runCli(
    ["capabilities", "--requires=headless"],
    { stderr: (text) => stderr.push(text) },
  );

  assert.equal(exitCode, 2);
  assert.match(stderr.join(""), /only supported by the explain command/);
});

test("explain produces complete, stable all-required ranking data without mutating the registry", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "switchyard-explain-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const registryPath = join(directory, "registry.json");
  const adapter = {
    id: "fixture",
    discover: async () => profile("fixture", "not-requested", ["headless", "mcp"]),
  };
  await discover({ registryPath, adapters: [adapter], now: () => new Date(observedAt) });

  const before = await readFile(registryPath, "utf8");
  const result = await explain({
    registryPath,
    requirements: { requires: ["headless", "mcp"] },
    now: () => new Date(observedAt),
  });
  const after = await readFile(registryPath, "utf8");

  assert.equal(result.status, "success");
  assert.equal(result.selectedHarness, "fixture");
  assert.deepEqual(result.candidates[0].matched, ["headless", "mcp"]);
  assert.deepEqual(result.candidates[0].missing, []);
  assert.deepEqual(
    result.candidates[0].verification.map((item) => item.verificationStatus),
    ["not-requested", "not-requested"],
  );
  assert.equal(result.candidates[0].ranking.verificationTier, "discovered");
  assert.equal(
    formatExplainHuman(result),
    formatExplainHuman(await explain({
      registryPath,
      requirements: { requires: ["headless", "mcp"] },
      now: () => new Date(observedAt),
    })),
    "human explanations must be byte-stable",
  );
  assert.equal(before, after, "explain must not mutate the registry");

  const human = formatExplainHuman(result);
  const json = JSON.parse(formatExplainJson(result));
  assert.match(human, /Requirements: headless, mcp/);
  assert.match(human, /Selection: fixture/);
  assert.equal(json.status, result.status);
  assert.deepEqual(json.requirements.requires, result.requirements.requires);
  assert.equal(json.selectedHarness, result.selectedHarness);
  assert.deepEqual(
    json.candidates.map((candidate) => ({
      harnessId: candidate.harnessId,
      matched: candidate.matched,
      missing: candidate.missing,
      qualifies: candidate.qualifies,
    })),
    result.candidates.map((candidate) => ({
      harnessId: candidate.harnessId,
      matched: candidate.matched,
      missing: candidate.missing,
      qualifies: candidate.qualifies,
    })),
  );

  const repeated = await explain({
    registryPath,
    requirements: { requires: ["headless", "mcp"] },
    now: () => new Date(observedAt),
  });
  assert.equal(formatExplainJson(result), formatExplainJson(repeated));
});

test("explain JSON uses the shared versioned decision contract", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "switchyard-decision-schema-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const registryPath = join(directory, "registry.json");
  await discover({
    registryPath,
    adapters: [{ id: "fixture", discover: async () => profile("fixture") }],
    now: () => new Date(observedAt),
  });

  const result = await explain({
    registryPath,
    requirements: { requires: ["headless"] },
    now: () => new Date(observedAt),
  });
  const payload = JSON.parse(formatExplainJson(result));
  assert.equal(payload.schemaVersion, DECISION_SCHEMA_VERSION);
  assert.equal(payload.command, "explain");
  assert.equal(payload.status, "success");
  assert.equal(parseCommandJson(formatExplainJson(result)).status, "success");
  assert.deepEqual(parseDecisionJson(formatExplainJson(result)), {
    schemaVersion: DECISION_SCHEMA_VERSION,
    command: "explain",
    status: "success",
  });
  assert.deepEqual(
    Object.keys(payload).slice(0, 4),
    ["schemaVersion", "command", "status", "registryPath"],
  );

  assert.equal(
    serializeCommandJson({
      schemaVersion: 1,
      command: "fixture",
      status: "success",
      value: "additive fields remain command-owned",
    }),
    JSON.stringify({
      schemaVersion: 1,
      command: "fixture",
      status: "success",
      value: "additive fields remain command-owned",
    }, null, 2),
  );
  assert.throws(
    () => parseCommandJson(JSON.stringify({ schemaVersion: 1, command: "explain" })),
    /status must be a non-empty string/,
  );
});

test("explain has distinct invalid-input and no-match CLI outcomes", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "switchyard-explain-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const registryPath = join(directory, "registry.json");
  const adapter = {
    id: "fixture",
    discover: async () => profile("fixture"),
  };
  await discover({ registryPath, adapters: [adapter], now: () => new Date(observedAt) });

  const noMatchStdout = [];
  const noMatchCode = await runCli(
    ["explain", `--requires=mcp`, "--json", "--registry", registryPath],
    { stdout: (text) => noMatchStdout.push(text), stderr: () => {} },
  );
  assert.equal(noMatchCode, 4);
  const noMatch = JSON.parse(noMatchStdout.join(""));
  assert.equal(noMatch.status, "no-match");
  assert.equal(noMatch.candidates[0].missing[0], "mcp");

  const invalidStdout = [];
  const invalidCode = await runCli(
    ["explain", "--requires=headless,headless", "--json"],
    { stdout: (text) => invalidStdout.push(text), stderr: () => {} },
  );
  assert.equal(invalidCode, 2);
  const invalid = JSON.parse(invalidStdout.join(""));
  assert.equal(invalid.status, "invalid-input");
  assert.equal(invalid.error.code, "invalid-input");
  assert.match(invalid.error.message, /duplicate/i);
});

test("explain subprocess emits stable JSON for success and distinct no-match/invalid exits", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "switchyard-explain-subprocess-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const registryPath = join(directory, "registry.json");
  await discover({
    registryPath,
    adapters: [{ id: "fixture", discover: async () => profile("fixture") }],
    now: () => new Date(observedAt),
  });

  const run = (args) => execFileAsync(
    process.execPath,
    ["--experimental-strip-types", "src/cli.ts", ...args],
    { cwd: process.cwd(), encoding: "utf8" },
  );
  const success = await run(["explain", "--requires=headless", "--json", "--registry", registryPath]);
  assert.equal(success.stderr, "");
  assert.equal(JSON.parse(success.stdout).selectedHarness, "fixture");

  await assert.rejects(
    run(["explain", "--requires=mcp", "--json", "--registry", registryPath]),
    (error) => {
      assert.equal(error.code, 4);
      assert.equal(JSON.parse(error.stdout).status, "no-match");
      return true;
    },
  );
  await assert.rejects(
    run(["explain", "--requires=headless,headless", "--json"]),
    (error) => {
      assert.equal(error.code, 2);
      assert.equal(JSON.parse(error.stdout).status, "invalid-input");
      return true;
    },
  );
});
