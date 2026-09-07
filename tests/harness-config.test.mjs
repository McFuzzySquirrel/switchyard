import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  ConfigPersistenceError,
  ConfigValidationError,
  assertSwitchyardConfig,
  defaultConfigPath,
  loadSwitchyardConfig,
  readSwitchyardConfig,
  resolveConfigPath,
  resolveEffectiveRegistryPath,
  resolveHarnessRuntimeConfig,
  validateSwitchyardConfig,
} from "../src/index.ts";

test("validates a well-formed configuration and rejects unrecognized top-level fields", () => {
  const result = validateSwitchyardConfig({
    schemaVersion: 1,
    registryPath: "/tmp/registry.json",
    probePolicy: { timeoutMs: 4000, maxOutputLength: 4096, allowMutatingProbes: false },
    harnesses: {
      opencode: { executable: "/opt/opencode/bin/opencode" },
    },
  });
  assert.equal(result.success, true);
  assert.equal(result.value.harnesses.opencode.executable, "/opt/opencode/bin/opencode");

  const invalid = validateSwitchyardConfig({
    registryPath: "/tmp/registry.json",
    unknownField: true,
  });
  assert.equal(invalid.success, false);
  assert.deepEqual(invalid.issues, [
    { path: "$.unknownField", message: "is not a recognized field" },
  ]);
});

test("reports actionable, secret-safe field diagnostics for invalid typed fields", () => {
  const secretLikeValue = "token=sk-abcdef0123456789-should-never-appear-in-diagnostics";
  const result = validateSwitchyardConfig({
    schemaVersion: 2,
    probePolicy: { timeoutMs: -5, allowMutatingProbes: "yes" },
    harnesses: {
      "Invalid ID!": { executable: secretLikeValue },
      opencode: { executable: 42 },
    },
  });

  assert.equal(result.success, false);
  const paths = result.issues.map((issue) => issue.path).sort();
  assert.deepEqual(paths, [
    "$.harnesses.Invalid ID!",
    "$.harnesses.opencode.executable",
    "$.probePolicy.allowMutatingProbes",
    "$.probePolicy.timeoutMs",
    "$.schemaVersion",
  ]);

  // The diagnostics identify field and expected shape only; the invalid
  // secret-like value must never be echoed back anywhere in the output.
  const serialized = JSON.stringify(result.issues);
  assert.equal(serialized.includes("sk-abcdef0123456789"), false);

  assert.throws(
    () => assertSwitchyardConfig({ probePolicy: { timeoutMs: -1 } }),
    (error) => {
      assert.ok(error instanceof ConfigValidationError);
      assert.equal(error.message.includes("sk-abcdef"), false);
      return true;
    },
  );
});

test("loads and validates a configuration file from disk, and treats a missing file as absent", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "switchyard-config-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const configPath = join(directory, "config.json");

  assert.equal(await readSwitchyardConfig(configPath), undefined);
  assert.deepEqual(await loadSwitchyardConfig(configPath), { schemaVersion: 1 });

  await writeFile(
    configPath,
    JSON.stringify({
      schemaVersion: 1,
      harnesses: { copilot: { executable: "/opt/copilot/bin/copilot" } },
    }),
  );
  const loaded = await readSwitchyardConfig(configPath);
  assert.equal(loaded.harnesses.copilot.executable, "/opt/copilot/bin/copilot");

  await writeFile(configPath, "{ not valid json");
  await assert.rejects(
    () => readSwitchyardConfig(configPath),
    (error) => {
      assert.ok(error instanceof ConfigPersistenceError);
      assert.equal(error.code, "invalid-json");
      return true;
    },
  );

  await writeFile(configPath, JSON.stringify({ registryPath: 5 }));
  await assert.rejects(
    () => readSwitchyardConfig(configPath),
    (error) => {
      assert.ok(error instanceof ConfigPersistenceError);
      assert.equal(error.code, "invalid-schema");
      assert.deepEqual(error.issues, [
        { path: "$.registryPath", message: "must be a non-empty string" },
      ]);
      return true;
    },
  );
});

test("resolves the configuration path from an explicit argument, then SWITCHYARD_CONFIG_PATH, then the platform default", () => {
  assert.equal(
    resolveConfigPath("/explicit/config.json", { env: { SWITCHYARD_CONFIG_PATH: "/env/config.json" } }),
    "/explicit/config.json",
  );
  assert.equal(
    resolveConfigPath(undefined, { env: { SWITCHYARD_CONFIG_PATH: "/env/config.json" } }),
    "/env/config.json",
  );
  assert.equal(
    resolveConfigPath(undefined, {
      env: {},
      platform: "linux",
      homeDirectory: "/home/example",
    }),
    defaultConfigPath({ env: {}, platform: "linux", homeDirectory: "/home/example" }),
  );
});

test("resolves per-harness executable and probe policy with explicit > environment > file > default precedence", () => {
  const config = {
    schemaVersion: 1,
    probePolicy: { timeoutMs: 3000, maxOutputLength: 2048, allowMutatingProbes: false },
    harnesses: {
      opencode: {
        executable: "/config/opencode",
        probePolicy: { timeoutMs: 6000 },
      },
    },
  };

  // File value applies when nothing else overrides it.
  const fileOnly = resolveHarnessRuntimeConfig("opencode", config, {}, {});
  assert.equal(fileOnly.configuredExecutable, "/config/opencode");
  assert.equal(fileOnly.executable, undefined);
  assert.equal(fileOnly.timeoutMs, 6000);
  assert.equal(fileOnly.maxOutputLength, 2048);
  assert.equal(fileOnly.allowMutatingProbes, false);

  // Environment overrides the file.
  const envOverridden = resolveHarnessRuntimeConfig("opencode", config, {}, {
    SWITCHYARD_OPENCODE_EXECUTABLE: "/env/opencode",
    SWITCHYARD_OPENCODE_PROBE_TIMEOUT_MS: "9000",
    SWITCHYARD_ALLOW_MUTATING_PROBES: "true",
  });
  assert.equal(envOverridden.executable, "/env/opencode");
  assert.equal(envOverridden.configuredExecutable, "/config/opencode");
  assert.equal(envOverridden.timeoutMs, 9000);
  assert.equal(envOverridden.allowMutatingProbes, true);

  // An explicit call-time override outranks both the environment and the file.
  const explicit = resolveHarnessRuntimeConfig(
    "opencode",
    config,
    { executable: "/explicit/opencode", timeoutMs: 1234 },
    {
      SWITCHYARD_OPENCODE_EXECUTABLE: "/env/opencode",
      SWITCHYARD_OPENCODE_PROBE_TIMEOUT_MS: "9000",
    },
  );
  assert.equal(explicit.executable, "/explicit/opencode");
  assert.equal(explicit.timeoutMs, 1234);

  // With nothing configured at all, built-in defaults apply.
  const defaults = resolveHarnessRuntimeConfig("copilot", {}, {}, {});
  assert.equal(defaults.executable, undefined);
  assert.equal(defaults.configuredExecutable, undefined);
  assert.equal(defaults.timeoutMs, 5000);
  assert.equal(defaults.maxOutputLength, 8192);
  assert.equal(defaults.allowMutatingProbes, false);
});

test("rejects an unparseable environment override with an actionable, variable-named diagnostic", () => {
  assert.throws(
    () =>
      resolveHarnessRuntimeConfig(
        "opencode",
        {},
        {},
        { SWITCHYARD_OPENCODE_PROBE_TIMEOUT_MS: "not-a-number" },
      ),
    (error) => {
      assert.ok(error instanceof ConfigValidationError);
      assert.deepEqual(error.issues, [
        {
          path: "env.SWITCHYARD_OPENCODE_PROBE_TIMEOUT_MS",
          message: "must be a positive integer",
        },
      ]);
      return true;
    },
  );

  assert.throws(
    () =>
      resolveHarnessRuntimeConfig(
        "opencode",
        {},
        {},
        { SWITCHYARD_ALLOW_MUTATING_PROBES: "maybe" },
      ),
    (error) => {
      assert.ok(error instanceof ConfigValidationError);
      assert.equal(error.issues[0].path, "env.SWITCHYARD_ALLOW_MUTATING_PROBES");
      return true;
    },
  );
});

test("resolves the effective registry path with explicit > env > config-file > default precedence", () => {
  const config = { registryPath: "/config/registry.json" };

  assert.equal(
    resolveEffectiveRegistryPath("/explicit/registry.json", config, {
      env: { SWITCHYARD_REGISTRY_PATH: "/env/registry.json" },
      platform: "linux",
    }),
    "/explicit/registry.json",
  );
  assert.equal(
    resolveEffectiveRegistryPath(undefined, config, {
      env: { SWITCHYARD_REGISTRY_PATH: "/env/registry.json" },
      platform: "linux",
    }),
    "/env/registry.json",
  );
  assert.equal(
    resolveEffectiveRegistryPath(undefined, config, { env: {}, platform: "linux" }),
    "/config/registry.json",
  );
  assert.equal(
    resolveEffectiveRegistryPath(undefined, {}, {
      env: {},
      platform: "linux",
      homeDirectory: "/home/example",
    }),
    join("/home/example", ".config", "switchyard", "registry.json"),
  );
});
