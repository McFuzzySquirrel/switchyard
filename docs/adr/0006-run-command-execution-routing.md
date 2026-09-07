# ADR-0006: Routing-to-execution `run` command and exit-code taxonomy

- **Status:** Accepted
- **Date:** 2026-09-07

## Context

`explain` produces a deterministic routing decision but never launches a
harness, and the execute-capable `HarnessAdapter` contract and process
runner existed with no CLI or library surface that connected them. Phase 2
of the Harness Execution Runtime feature (`EXEC-FR-01` through `EXEC-FR-07`)
requires a command that takes a routed selection to adapter execution while
keeping routing, adapter argument translation, and process execution owned
by their existing modules.

## Decision

- Add `run` (`src/commands/run.ts`) as the single command that connects
  routing to execution. `run` calls `explain` internally to obtain the
  selected harness and never reimplements matching or ranking; for a normal
  run it translates the decision into an `ExecutionRequest` and hands it to
  the adapter registered for the selected harness ID.
- Before invoking `adapter.execute`, `run` checks
  `adapter.supportedOperations.execute` and treats a missing adapter or an
  adapter that does not declare `execute` support as `status: "unavailable"`
  with `failureCategory: "unavailable"`, without calling `execute`. A
  `UnsupportedOperationError` thrown by the adapter itself is caught as a
  defensive fallback and produces the same stable result shape, never an
  uncaught exception.
- `run` accepts `dryRun`; when set, it returns a synthetic
  `ExecutionResult.status: "dry-run"` after routing and does not resolve or
  invoke an adapter. This prevents an adapter that mishandles the flag from
  launching a vendor process, and permits previewing a selection before its
  executable is installed. `run` reports this as its own `"dry-run"` status,
  distinct from `"success"`.
- `RunCommandResult` uses the shared versioned JSON envelope
  (`schemaVersion`, `command: "run"`, `status`) and a status taxonomy of
  `success`, `dry-run`, `no-match`, `invalid-input`, `unavailable`, and
  `execution-failure`. `execution-failure` covers a completed process with a
  non-zero exit, a timeout, or a cancellation; the nested `execution` field
  retains the finer-grained `ExecutionResult.status`/`failureCategory` for
  callers that need that detail.
- Extend `CLI_EXIT_CODES` with `unavailable: 5`. `no-match` and
  `invalid-input` reuse the existing `4` and `2` categories from `explain`;
  `execution-failure` reuses the existing generic `failure` (`3`) category
  used for other command errors; `success` and `dry-run` both exit `0`.
- The CLI accepts a positional task string for `run`
  (`switchyard run --requires=<capabilities> [--json] [--dry-run] "<task>"`)
  plus `--cwd` and `--timeout-ms` execution controls; `--requires`,
  `--preferred-harness`, and `--allow-fallback` are now shared between
  `explain` and `run` instead of being explain-only.

## Consequences

- Routing (`routing-policy-engineer`) and adapter argument translation
  (`adapter-platform-engineer`) remain untouched: `run` only calls the
  existing `explain` export and the existing `HarnessAdapter.execute`
  contract.
- Built-in `opencode` and `copilot` adapters currently declare
  discovery-only support, so `run` against them deterministically reports
  `unavailable` today; no adapter change is required for `run` to behave
  correctly once a real `execute` implementation is registered.
- Scripts can distinguish "nothing qualified" (`4`), "input was invalid"
  (`2`), "the routed harness cannot execute" (`5`), and "the harness ran but
  failed" (`3`) without parsing human diagnostics.
- `CLI_EXIT_CODES` gained a new key; existing numeric values for `success`,
  `partial`, `invalidInput`/`usage`, `failure`, and `noMatch` are unchanged.

## Alternatives considered

- **Re-implement selection inside `run`:** Rejected because it would
  duplicate the matcher/ranking policy and risk the two commands disagreeing
  on which harness is selected.
- **Let an unsupported operation throw out of `run`:** Rejected because
  automation needs a stable, parseable result and exit code instead of an
  uncaught exception for a normal, expected adapter state.
- **Fold `unavailable` into the existing generic `failure` exit code:**
  Rejected because `EXEC-FR-06` requires `unavailable` to be distinguishable
  from an ordinary execution failure at the exit-code level, not only inside
  the JSON payload.
