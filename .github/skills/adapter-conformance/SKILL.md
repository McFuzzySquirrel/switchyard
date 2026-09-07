---
name: adapter-conformance
description: "Repeatable procedure and fixtures for implementing, registering, normalizing, and validating a Switchyard harness adapter without matcher changes."
---

# Skill: Adapter Conformance

Use this skill when a new or modified Switchyard harness adapter needs a conformance pass before it is treated as production-ready. It provides the cross-adapter procedure for registration, normalization, capability matching, and validation without changing the matcher contract.

Load [`references/adapter-checklist.md`](./references/adapter-checklist.md) now. It contains the registration checklist, supported-operation matrix, config precedence rules, and conformance assertions shared by the adapter platform and QA flows.

## Process

### Step 1: Define the adapter contract

Start with the vendor-neutral interface that the adapter must satisfy. Keep vendor parsing isolated to the adapter module and map all normalized operations back to the shared capability vocabulary. Do not add adapter-specific matcher logic outside the adapter boundary.

**Inputs needed:**
- adapter name and executable override
- supported operations and unsupported operations
- config fields and environment precedence rules

**Output:**
- a normalized adapter contract with explicit supported and unsupported operations

### Step 2: Implement the stub registration path

Create or update a stub adapter that exercises registration, discovery, verification, execution, and any unsupported-operation declarations. Register it through the same factory or registry path used in production so the conformance suite catches real integration issues.

**Output:**
- a stub adapter that registers without matcher changes

### Step 3: Normalize capabilities and config

Verify that capabilities use the shared vocabulary and that configuration precedence is deterministic. Confirm executable overrides, env overrides, and local config values are normalized before adapter invocation; invalid fields must fail with actionable diagnostics.

**Output:**
- capability normalization and configuration precedence assertions

### Step 4: Run the conformance suite

Exercise success, dry-run, unsupported operation, invalid config, and result-shaping scenarios through the same adapter boundary used by the runtime. The suite should fail fast on any operation that depends on a matcher rewrite or hidden vendor syntax.

**Output:**
- a conformance report showing the adapter works under the project contract

### Step 5: Ship the adapter with evidence

Record the test evidence and keep the fixture reusable for future adapters. If the adapter is built-in, ensure its capabilities remain accurate and stable across discovery, verification, execution, and resume flows.

**Output:**
- reusable adapter evidence and a checked-in conformance suite

## Gotchas

- **Executable overrides must be consistent.** A config override that affects discovery but not execution creates false confidence and breaks the adapter contract.
- **Unsupported operations must fail before launch.** If the adapter reports support incorrectly, the runtime will execute a bad vendor command and mask the real contract problem.
- **Adapter-local labels are not enough.** Capability vocabulary must be normalized to the shared Switchyard schema or the runtime will misroute requests.
- **Matcher changes are a smell.** If the adapter requires matcher logic changes to work, the contract or the adapter is wrong.

## Validation

After the adapter passes, verify:

- [ ] the stub adapter registers cleanly with the project registry and no matcher changes
- [ ] supported and unsupported operations are reported accurately
- [ ] config precedence and invalid-field diagnostics are deterministic
- [ ] execution, verification, and discovery use the same normalized adapter contract
- [ ] `npm test -- --test-name-pattern "adapter|conformance"` or the equivalent project suite passes

If the conformance step fails, return to the registration matrix and verify config precedence before changing the matcher or adapter contract.
