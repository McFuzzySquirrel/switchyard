import assert from "node:assert/strict";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  BUILT_IN_DISCOVERY_ADAPTERS,
  HarnessDiscoveryAdapterRegistry,
  createGitHubCopilotDiscoveryAdapter,
  createOpenCodeDiscoveryAdapter,
  parseGitHubCopilotCapabilities,
  parseOpenCodeCapabilities,
  validateHarnessProfile,
} from "../src/index.ts";

const observedAt = "2026-09-07T19:00:00.000Z";
const fixedClock = () => new Date(observedAt);

async function makeScript(directory, name, content) {
  const path = join(directory, name);
  await writeFile(path, `#!/bin/sh\n${content}\n`);
  await chmod(path, 0o755);
  return path;
}

test("registers the explicit built-in discovery adapters with no execution claims", () => {
  assert.deepEqual(
    BUILT_IN_DISCOVERY_ADAPTERS.map((adapter) => adapter.id),
    ["opencode", "copilot"],
  );
  for (const adapter of BUILT_IN_DISCOVERY_ADAPTERS) {
    assert.deepEqual(adapter.supportedOperations, {
      discover: true,
      verify: false,
      execute: false,
      resume: false,
      fork: false,
    });
  }

  const registry = new HarnessDiscoveryAdapterRegistry(BUILT_IN_DISCOVERY_ADAPTERS);
  assert.equal(registry.get("opencode")?.displayName, "OpenCode");
  assert.equal(registry.get("copilot")?.displayName, "GitHub Copilot");
  assert.throws(
    () => registry.register(createOpenCodeDiscoveryAdapter()),
    /already registered/,
  );
});

test("parses supported CLI-help fixtures into the normalized capability vocabulary", async () => {
  const fixtures = [
    {
      file: "opencode-help.txt",
      parse: parseOpenCodeCapabilities,
      expected: [
        "headless",
        "model-selection",
        "continue",
        "fork",
        "mcp",
        "local-models",
      ],
    },
    {
      file: "copilot-help.txt",
      parse: parseGitHubCopilotCapabilities,
      expected: [
        "headless",
        "model-selection",
        "continue",
        "mcp",
        "github-context",
      ],
    },
  ];

  for (const fixture of fixtures) {
    const helpText = await readFile(
      new URL(`./fixtures/discovery/${fixture.file}`, import.meta.url),
      "utf8",
    );
    assert.deepEqual(fixture.parse(helpText), fixture.expected, fixture.file);
  }

  assert.deepEqual(
    parseGitHubCopilotCapabilities("GitHub Copilot CLI\nOptions: --silent"),
    [],
  );
});

test("discovers OpenCode through an executable override with bounded version and help probes", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "switchyard-opencode-adapter-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const override = await makeScript(
    directory,
    "custom-opencode",
    `
case "$1" in
  --version) echo "opencode 9.8.7"; exit 0 ;;
  --help)
    echo "Usage: opencode [command]"
    echo "Commands: run mcp fork"
    echo "Options: --model <model> --continue"
    echo "Providers: Ollama local models"
    printf '%0500d\n' 0
    exit 0 ;;
  *) echo "unexpected probe argument: $1"; exit 32 ;;
esac`,
  );
  await makeScript(
    directory,
    "opencode",
    'if [ "$1" = "--version" ]; then echo "opencode 0.0.1"; else echo "Usage: opencode"; fi',
  );

  const profile = await createOpenCodeDiscoveryAdapter().discover({
    executable: override,
    env: { PATH: directory },
    timeoutMs: 100,
    maxOutputLength: 256,
    now: fixedClock,
  });

  assert.equal(profile.status, "available");
  assert.equal(profile.executable, override);
  assert.equal(profile.executableSource, "override");
  assert.equal(profile.version, "9.8.7");
  assert.deepEqual(
    profile.capabilities.map((observation) => observation.capability),
    ["headless", "model-selection", "continue", "fork", "mcp", "local-models"],
  );
  assert.equal(profile.discoveredAt, observedAt);
  assert.equal(profile.capabilities[0].discovery.evidence.reference, "--help");
  assert.ok(profile.capabilities[0].discovery.evidence.excerpt.includes("[truncated]"));
  assert.equal(validateHarnessProfile(profile).success, true);
});

test("discovers GitHub Copilot through a configured executable and normalizes its capabilities", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "switchyard-copilot-adapter-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const configured = await makeScript(
    directory,
    "copilot-fixture",
    `
case "$1" in
  --version) echo "github copilot cli v1.2.3"; exit 0 ;;
  --help)
    echo "Usage: copilot --prompt <task>"
    echo "Options: --model <model> --resume"
    echo "Commands: mcp issues pull requests"
    exit 0 ;;
  *) exit 32 ;;
esac`,
  );

  const profile = await createGitHubCopilotDiscoveryAdapter().discover({
    configuredExecutable: configured,
    env: { PATH: "" },
    now: fixedClock,
  });

  assert.equal(profile.status, "available");
  assert.equal(profile.executableSource, "configured");
  assert.equal(profile.version, "1.2.3");
  assert.deepEqual(
    profile.capabilities.map((observation) => observation.capability),
    ["headless", "model-selection", "continue", "mcp", "github-context"],
  );
  assert.equal(validateHarnessProfile(profile).success, true);
});

test("returns a schema-valid actionable unavailable profile when a built-in is missing", async () => {
  const profile = await createGitHubCopilotDiscoveryAdapter().discover({
    executable: "/not/a/real/copilot",
    env: { PATH: "" },
    now: fixedClock,
  });

  assert.equal(profile.status, "unavailable");
  assert.equal(profile.lifecycle, "unavailable");
  assert.equal(profile.executableSource, "override");
  assert.equal(profile.diagnostics?.[0].code, "executable-not-found");
  assert.match(profile.availability.reason, /GitHub Copilot executable was not found/);
  assert.equal(validateHarnessProfile(profile).success, true);
});

test("returns an explicit aborted diagnostic before launching a probe", async () => {
  const controller = new AbortController();
  controller.abort();

  const profile = await createOpenCodeDiscoveryAdapter().discover({
    executable: "/not/a/real/opencode",
    signal: controller.signal,
    now: fixedClock,
  });

  assert.equal(profile.status, "unavailable");
  assert.equal(profile.diagnostics?.[0].code, "probe-aborted");
  assert.match(profile.availability.reason, /discovery was aborted before probing/);
  assert.equal(validateHarnessProfile(profile).success, true);
});

test("classifies successful but malformed help output without claiming capabilities", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "switchyard-malformed-adapter-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const executable = await makeScript(
    directory,
    "opencode",
    `
case "$1" in
  --version) echo "opencode 2.0.0"; exit 0 ;;
  --help) echo "this is a wrapper banner, not help"; exit 0 ;;
  *) exit 32 ;;
esac`,
  );

  const profile = await createOpenCodeDiscoveryAdapter().discover({
    executable,
    now: fixedClock,
  });

  assert.equal(profile.status, "malformed");
  assert.equal(profile.capabilities.length, 0);
  assert.equal(profile.diagnostics?.[0].code, "probe-malformed");
  assert.equal(validateHarnessProfile(profile).success, true);
});
