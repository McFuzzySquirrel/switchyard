#!/usr/bin/env node

const mode = process.env.SWITCHYARD_FIXTURE_MODE ?? "available";
const sentinel = process.env.SWITCHYARD_FIXTURE_SENTINEL;

if (sentinel !== undefined) {
  const { writeFileSync } = await import("node:fs");
  writeFileSync(sentinel, "launched\n");
}

switch (process.argv[2]) {
  case "--version":
    if (mode === "failure") {
      process.exitCode = 17;
    } else {
      console.log("fixture-harness 1.0.0");
    }
    break;
  case "--help":
    if (mode === "malformed") {
      console.log("fixture wrapper banner");
    } else if (mode === "failure") {
      process.exitCode = 17;
    } else {
      console.log("Usage: fixture-harness --prompt <task> --model <model> --continue");
    }
    break;
  default:
    if (mode === "failure") {
      process.exitCode = 17;
    }
}
