# ADR-0004: Explicit execution request and result process-boundary contract

- **Status:** Accepted
- **Date:** 2026-09-07

## Context

The initial `HarnessAdapter` contract represented execution with only a task,
working directory, timeout, dry-run flag, and basic output fields. That shape
did not carry the controls needed to safely cross a subprocess boundary or
provide enough metadata for automation to distinguish ordinary failures from
timeouts, cancellation, unavailable harnesses, and non-launching dry runs.

## Decision

- Keep the vendor-neutral execution types in `src/harness/adapter.ts` beside
  the `HarnessAdapter` operation contracts.
- Extend `ExecutionRequest` with explicit environment values and an
  allow/deny inheritance policy, controlled stdin, output and timeout bounds,
  cancellation via `AbortSignal`, non-interactive mode, and dry-run intent.
- Extend `ExecutionResult` with a stable lifecycle status, stable failure
  category, nullable exit code, optional termination signal, per-stream
  truncation flags, duration, and an optional redacted diagnostic while
  retaining the existing success/output fields.
- Use `none`, `invalid-input`, `no-match`, `unavailable`,
  `execution-failure`, `timeout`, and `cancelled` as the stable failure
  categories. A dry run has `status: "dry-run"` and
  `failureCategory: "none"` because it intentionally does not launch.
- Keep adapter-specific command arguments outside this contract. Adapters
  translate the normalized task into safe argument arrays or controlled stdin;
  the process runner applies working-directory, environment, timeout,
  cancellation, and output-boundary controls.

## Consequences

Execution consumers can make deterministic decisions without parsing human
diagnostics, and process cleanup outcomes remain distinguishable from ordinary
non-zero exits. Environment policy is represented at the boundary instead of
being implicit in each adapter. The subsequent runtime implementation must
enforce these fields, redact diagnostics before presentation, and never
interpolate request data into shell code. Adding required result metadata is a
contract evolution for full adapters; the checked-in stub fixture is updated
to provide the complete shape.

## Alternatives considered

- **Leave execution as a task and two output strings:** Rejected because it
  cannot express safe environment inheritance, cancellation, bounded-output
  state, or stable failure classification.
- **Expose vendor-specific argument arrays on `ExecutionRequest`:** Rejected
  because invocation syntax belongs to the adapter owner and would couple
  routing/runtime code to individual harnesses.
- **Encode timeout and cancellation only in free-form error text:** Rejected
  because scripts and workflow composition need stable, machine-readable
  discriminators.
