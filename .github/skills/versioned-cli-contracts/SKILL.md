---
name: versioned-cli-contracts
description: "Procedure for evolving Switchyard human and JSON command results with stable schemas, exit categories, no-color parity, and redaction checks."
---

# Skill: Versioned CLI Contracts

Use this skill when evolving Switchyard output contracts, exit categories, or CLI behavior in a way that must remain compatible with scripts and plain terminals. It provides the change procedure for versioned JSON payloads, stable human output, no-color parity, and redaction-safe diagnostics.

Load [`references/cli-contract-checklist.md`](./references/cli-contract-checklist.md) now. It contains the compatibility rubric, redaction checks, exit classification rules, and validation steps used by the architect and QA flows.

## Process

### Step 1: Determine impact and compatibility level

Before changing a CLI result or schema, assess whether the change is additive, breaking, or usability-only. Decide whether a new version or a backward-compatible default is needed. Preserve stable keys whenever possible and avoid silently reinterpreting existing exit categories.

**Inputs needed:**
- current command contract
- affected JSON shape or human output
- expected compatibility range

**Output:**
- a compatibility decision with a documented release posture

### Step 2: Add or evolve the stable schema

Define the schema and serializer boundary in the shared contract layer, not per-command code. Keep JSON output parseable and stable across versions, and add compatibility defaults when old fields remain legal. Do not leak secrets or vendor-specific details into the shared result type.

**Output:**
- a versioned or backward-compatible CLI payload contract

### Step 3: Keep human and JSON output aligned

Make sure the human-readable command output and the JSON payload reflect the same exit category and status. Validate no-color parity side-by-side so a plain terminal and a scriptable output path tell the same story.

**Output:**
- parity-checked human and JSON diagnostics for the modified command

### Step 4: Enforce redaction and exit categories

Check that secrets are removed before they appear in CLI logs or structured results. Confirm each command uses the project’s stable exit vocabulary and that established categories remain distinct for timeout, cancellation, unsupported operation, and nonzero execution.

**Output:**
- redaction-safe output and consistent exit categories

### Step 5: Validate the contract with fixtures

Run the CLI contract tests against a fixture command or stub harness. Confirm the schema remains parseable, the no-color output is equivalent to the colorized path, and the compatibility check passes when a new field is added or an old key remains optional.

**Output:**
- contract-level test evidence and compatibility notes

## Gotchas

- **Schema changes without a version guard are breaking.** If the command output is consumed by scripts, treat field additions and renamed keys as compatibility-sensitive changes.
- **No-color parity is not optional.** A command that only looks correct in ANSI-enabled terminals can still fail plain-terminal and CI usage.
- **Exit categories must stay stable.** Reusing a generic nonzero code for timeout, cancellation, and unsupported operation makes automation impossible.
- **Redaction checks must cover both human and JSON output.** A secret hidden in the console but exposed in JSON is still a security bug.

## Validation

After changing the contract, verify:

- [ ] the JSON schema remains parseable and the compatibility story is explicit
- [ ] human output and no-color output match on status, exit category, and key fields
- [ ] secret values are redacted in both CLI text and structured JSON output
- [ ] exit categories remain stable for timeout, cancellation, and nonzero execution
- [ ] `npm test -- --test-name-pattern "cli|schema"` or the equivalent project suite passes

If the command change introduces a new field or a status rename, re-check the compatibility story before shipping the update.
