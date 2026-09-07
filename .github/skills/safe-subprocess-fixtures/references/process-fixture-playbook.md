# Process Fixture Playbook

> Load when: the test needs a reusable child-process stub, a timeout or cancellation case, or a redaction assertion for diagnostic output.

## Stable fixture contract

Define each fixture around a single unsafe behavior:

- `spawnSpec` sets argv, env, cwd, timeoutMs, and maxOutputBytes.
- `expectedExit` is a stable integer or a named exit category.
- `stdout` and `stderr` are captured via fixed-size buffers, not unbounded strings.
- `redactions` lists secret tokens that must stay hidden in both logs and JSON payloads.

Use `node:child_process.spawn` with explicit arguments or `stdin` bytes. Avoid `shell: true` in tests because shell quoting masks the exact command contract and makes redaction leaks harder to reason about.

## Output-bound assertions

The test should assert all of the following:

1. The child never exceeds the configured output cap.
2. The parent keeps both a `raw` diagnostic and a `sanitized` view for failure reporting.
3. The truncated body remains readable while the metadata remains complete.
4. Secret values are replaced with a redaction marker before they reach the CLI or JSON output.

Example pattern:

```ts
const result = await runStub({
  args: ["slow", "stdout"],
  timeoutMs: 250,
  maxOutputBytes: 4096,
  redactions: ["TOKEN_123"],
});

assert.equal(result.exitCategory, "timeout");
assert.ok(result.stdout.includes("[truncated]"));
assert.equal(result.stderr.includes("TOKEN_123"), false);
```

## Cancellation and timeout checks

For each test, assert the distinction between:

- `timeout` when the child exceeds the permitted runtime
- `cancelled` when an external signal stops the process early
- `nonzero-exit` when a stub exits with an error but within the allowed window

On timeout or cancellation, the fixture should terminate the process tree. For POSIX systems, use a kill group or negative PID pattern; on Windows, use a process-tree kill helper that closes descendants before returning control.

## Descendant cleanup

A robust fixture should create a parent that launches a grandchild. After cancellation or timeout, assert:

- the parent is no longer running
- the grandchild is no longer running
- the runtime reports the correct failure classification
- any diagnostics still contain the redaction markers without raw secrets

## Reuse checklist

Reuse this file when a new runtime flow needs the same process-safety evidence:

- adapter execution
- registry verification probes
- CLI subprocess smoke tests
- workflow stage execution
- regression tests for cancellation or timeouts
