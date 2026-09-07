import assert from "node:assert/strict";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { findExecutable } from "../src/index.ts";

async function executable(directory, name, mode = 0o755) {
  const path = join(directory, name);
  await writeFile(path, "#!/bin/sh\nexit 0\n");
  await chmod(path, mode);
  return path;
}

test("resolves an executable from PATH and skips non-executable files", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "switchyard-lookup-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await executable(directory, "unavailable", 0o644);
  const expected = await executable(directory, "available");

  assert.deepEqual(
    await findExecutable("available", {
      env: { PATH: directory },
      platform: "linux",
    }),
    { executable: expected, source: "path" },
  );
  assert.equal(
    await findExecutable("unavailable", { env: { PATH: directory }, platform: "linux" }),
    undefined,
  );
});

test("prefers valid overrides, then configured executables, before PATH", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "switchyard-lookup-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const override = await executable(directory, "override");
  const configured = await executable(directory, "configured");
  const pathExecutable = await executable(directory, "tool");

  assert.deepEqual(
    await findExecutable("tool", {
      overrides: [join(directory, "missing"), override],
      configured: [configured],
      env: { PATH: directory },
      platform: "linux",
    }),
    { executable: override, source: "override" },
  );
  assert.deepEqual(
    await findExecutable("tool", {
      configured: [configured],
      env: { PATH: directory },
      platform: "linux",
    }),
    { executable: configured, source: "configured" },
  );
  assert.deepEqual(
    await findExecutable("tool", { env: { PATH: directory }, platform: "linux" }),
    { executable: pathExecutable, source: "path" },
  );
});

test("applies Windows PATH, PATHEXT, and case-insensitive environment rules", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "switchyard-lookup-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const expected = await executable(directory, "harness.CMD", 0o644);

  assert.deepEqual(
    await findExecutable("harness", {
      env: { path: directory, pathext: ".CMD" },
      platform: "win32",
    }),
    { executable: expected, source: "path" },
  );
});

test("rejects unsafe or unavailable command inputs without executing them", async () => {
  assert.equal(await findExecutable(""), undefined);
  assert.equal(await findExecutable("tool\0argument"), undefined);
  assert.equal(await findExecutable("missing", { env: {}, platform: "linux" }), undefined);
});
