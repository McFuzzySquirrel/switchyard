---
name: safe-subprocess-fixtures
description: "Reusable cross-platform stub-process fixtures and assertions for bounded output, timeout, cancellation, descendant cleanup, and redacted diagnostics."
---

# Skill: Safe Subprocess Fixtures

Use this skill when tests must exercise child-process safety in Switchyard without depending on real external tools. It provides reusable stub-process and assertion patterns for bounded output, timeout, cancellation, descendant cleanup, and redacted diagnostics.

Load [`references/process-fixture-playbook.md`](./references/process-fixture-playbook.md) now. It contains the cross-platform spawn contract, output-limit helpers, cancellation hooks, and redaction assertions used by discovery, execution, and QA.

## Process

### Step 1: Model the stub contract

Define the fake child process before writing the test. Keep the command deterministic: pass argv arrays or stdin bytes; never interpolate shell strings; capture output in fixed-size buffers; declare exit code, timeout mode, and whether descendants are spawned.

**Inputs needed:**
- desired exit code
- expected stdout/stderr bytes
- timeout/cancel scenario
- whether the child should fork descendants

**Output:**
- a stub process fixture with explicit output and lifecycle expectations

### Step 2: Bound and assert output

Use a helper to cap bytes before emitting them to the parent. Assert both the truncated body and the preserved metadata: command, status, and redacted secrets. Keep the human output path and JSON result path separate so tests prove redaction on both.

**Output:**
- assertions for output limits, line truncation, and redaction

### Step 3: Exercise timeout and cancellation

Spawn the stub with a deliberate delay or block, then drive a timeout or cancellation signal. Verify the runtime records the right exit category and tears down the process tree instead of leaving a lingering child.

**Output:**
- one timeout test and one cancel test, each proving process cleanup

### Step 4: Validate descendant cleanup

Create a child process that spawns its own grandchild, then cancel or time out the parent. Confirm the descendant is also terminated and no orphan process remains in the fixture loop.

**Output:**
- a descendant-cleanup assertion that is portable across Linux/macOS/Windows

### Step 5: Reuse the fixture in runtime tests

Plug the same stub and assertions into registry, verification, execution, and CLI tests. Keep fixtures central so every process-dangerous feature uses the same safety contract.

**Output:**
- a shared process-fixture test pattern ready for new runtime coverage

## Gotchas

- **Timeouts must distinguish from ordinary failures.** A process that times out should keep a dedicated exit category, not a generic nonzero exit.
- **Shell interpolation is forbidden.** If a path or secret is part of the command, pass it as argv or stdin; embedding it in a shell string bypasses the safety contract.
- **Discarding stderr silently is wrong.** Bound and redact diagnostic output before reporting it, especially in CI and no-color runs.
- **Windows process trees require explicit cleanup.** A parent kill is not enough if descendants keep running.

## Validation

After implementing or updating the fixture, verify:

- [ ] the stub can produce bounded stdout and stderr without exceeding the configured byte limit
- [ ] timeout and cancellation are reported as distinct failure modes
- [ ] descendant cleanup is asserted with a child/grandchild process pair
- [ ] redacted secrets stay hidden in both human and JSON diagnostics
- [ ] `node --test` or the project’s subprocess suite completes without orphaned child processes

If the standard checks fail, step back to the cleanup contract and re-run the redaction and descendant assertions before changing the runtime logic.
