# ADR-0005: Bounded direct process execution

- **Status:** Accepted
- **Date:** 2026-09-07

## Context

Execution adapters need one consistent process boundary for working-directory
and environment controls, bounded output, cancellation, and timeout cleanup.
Discovery probing already spawns processes, but its result shape and direct
child termination are not sufficient for task execution.

## Decision

Implement `executeProcess` and `runProcess` in `src/harness/process.ts`.
Adapters provide an executable and an argv array; the runner always disables
shell execution. Environment inheritance is filtered by the request's
allow/deny policy before explicit values are applied. stdout and stderr are
captured independently with fixed character limits. POSIX executions use a
dedicated process group; Windows executions use `taskkill /T /F` to terminate
descendants. Timeout and cancellation remain distinct result categories, and
diagnostics are redacted before they are returned.

## Consequences

Adapters share safe lifecycle behavior and machine-readable results without
duplicating subprocess code. The runner owns process cleanup and output bounds,
while adapters retain ownership of vendor-specific argument translation.
Platform process-tree behavior must remain covered by cross-platform fixtures.

## Alternatives considered

- **Reuse the discovery probe:** Rejected because it cannot express the
  execution result lifecycle or reliably clean up descendants.
- **Spawn through a shell:** Rejected because task, path, and secret values
  would become vulnerable to shell interpretation.
- **Kill only the direct child:** Rejected because descendants could remain
  orphaned after timeout or cancellation.
