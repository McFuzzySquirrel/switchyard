# ADR-0010: Top-level session lifecycle commands

- **Status:** Accepted
- **Date:** 2026-09-08

## Context

The adapter contract already models provider-specific `resume` and `fork`
operations, but users could only reach prompt execution through the CLI. Session
IDs are provider-specific and must not be routed as ordinary capability-based
tasks. OpenCode exposes resume and fork, while GitHub Copilot exposes resume but
not a dedicated fork operation.

## Decision

- Add top-level `resume` and `fork` commands.
- Require `--harness` and `--session` for both commands.
- Translate session requests to provider arguments inside each adapter and run
  them through the bounded, direct process runtime.
- Support resume for OpenCode and GitHub Copilot.
- Support fork for OpenCode only; Copilot reports it as unsupported before
  launching a process.
- Return the new OpenCode session ID from a successful fork.

## Consequences

- Session operations are explicit and scriptable without duplicating routing.
- Provider session IDs remain opaque to Switchyard and are not incorrectly
  treated as portable across harnesses.
- Fork result parsing depends on OpenCode's machine-readable output retaining a
  session identifier.
- Verification remains a separate operation and is not enabled by this ADR.

## Alternatives considered

- **Route resume and fork through `run`:** Rejected because session IDs and
  lifecycle semantics are provider-specific.
- **Expose only library adapter methods:** Rejected because the feature would
  not be available through the supported CLI workflow.
- **Claim Copilot fork support from interactive `/fork`:** Rejected because it
  is not a dedicated non-interactive provider operation.
