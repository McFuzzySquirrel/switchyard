import assert from "node:assert/strict";
import { chmod, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  RegistryPersistenceError,
  loadRegistry,
  readRegistry,
  writeRegistry,
} from "../src/index.ts";

const observedAt = "2026-09-07T19:00:00.000Z";

function registry(id = "fixture") {
  return {
    schemaVersion: 1,
    vocabularyVersion: "1.0",
    generatedAt: observedAt,
    updatedAt: observedAt,
    harnesses: [
      {
        schemaVersion: 1,
        id,
        displayName: "Fixture Harness",
        executable: "/opt/fixture/harness",
        executableSource: "path",
        version: "1.2.3",
        capabilities: [],
        status: "available",
        lifecycle: "registered",
        availability: {
          status: "available",
          checkedAt: observedAt,
        },
        discoveredAt: observedAt,
        updatedAt: observedAt,
      },
    ],
  };
}

test("writes a synced registry through a same-directory temporary file and reloads it", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "switchyard-registry-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, "nested", "registry.json");
  const expected = registry();

  await writeRegistry(path, expected);

  assert.deepEqual(await readRegistry(path), expected);
  assert.deepEqual(JSON.parse(await readFile(path, "utf8")), expected);
  const entries = await readdir(join(directory, "nested"));
  assert.deepEqual(entries, ["registry.json"]);

  if (process.platform !== "win32") {
    assert.equal((await stat(path)).mode & 0o777, 0o600);
  }
});

test("does not replace a valid snapshot when a new registry fails schema validation", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "switchyard-registry-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, "registry.json");
  const expected = registry();
  await writeRegistry(path, expected);

  await assert.rejects(
    () => writeRegistry(path, { ...expected, schemaVersion: 99 }),
    /schema version 1/,
  );
  assert.deepEqual(await readRegistry(path), expected);
});

test("reports malformed on-disk JSON without executing or partially accepting it", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "switchyard-registry-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, "registry.json");
  await writeFile(path, '{"harnesses":');

  await assert.rejects(
    () => loadRegistry(path),
    (error) => {
      assert.ok(error instanceof RegistryPersistenceError);
      assert.equal(error.code, "invalid-json");
      assert.equal(error.issues.length, 0);
      return true;
    },
  );
});

test("treats missing registries as empty reads while exposing a strict loader", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "switchyard-registry-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, "registry.json");

  assert.equal(await readRegistry(path), undefined);
  await assert.rejects(
    () => loadRegistry(path),
    (error) => error instanceof RegistryPersistenceError && error.code === "not-found",
  );
});

test("ignores orphaned temporary files left by an interrupted writer", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "switchyard-registry-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, "registry.json");
  const expected = registry();
  await writeRegistry(path, expected);
  await writeFile(`${path}.123.orphan.tmp`, "not executable content");
  await chmod(`${path}.123.orphan.tmp`, 0o600);

  assert.deepEqual(await readRegistry(path), expected);
});
