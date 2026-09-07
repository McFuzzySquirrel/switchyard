import test from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

const root = process.cwd();

async function read(relativePath) {
  return readFile(join(root, relativePath), "utf8");
}

test("canonical documentation files exist and contain required sections", async () => {
  const agents = await read("AGENTS.md");
  const readme = await read("README.md");
  const changelog = await read("CHANGELOG.md");

  assert.match(agents, /README\.md/);
  assert.match(agents, /CHANGELOG\.md/);
  assert.match(agents, /docs\/adr/);
  assert.match(readme, /^# Switchyard/m);
  assert.match(readme, /^## Current status/m);
  assert.match(readme, /^## Development/m);
  assert.match(changelog, /^# Changelog/m);
  assert.match(changelog, /^## \[Unreleased\]/m);
});

test("at least one ADR follows the numbered naming convention and required structure", async () => {
  const adrDirectory = join(root, "docs", "adr");
  const entries = await readdir(adrDirectory, { withFileTypes: true });
  const adrNames = entries
    .filter((entry) => entry.isFile() && /^\d{4}-[a-z0-9]+(?:-[a-z0-9]+)*\.md$/.test(entry.name))
    .map((entry) => entry.name);

  assert.notEqual(adrNames.length, 0);

  const adr = await read(join("docs", "adr", adrNames[0]));
  assert.match(adr, /^# ADR-\d{4}:/m);
  assert.match(adr, /^## Context/m);
  assert.match(adr, /^## Decision/m);
  assert.match(adr, /^## Consequences/m);
  assert.match(adr, /^## Alternatives considered/m);
});
