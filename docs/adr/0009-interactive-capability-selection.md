# ADR-0009: Interactive capability selection for prompt execution

- **Status:** Accepted
- **Date:** 2026-09-08

## Context

Users should not need to memorize normalized capability names or know which
provider exposes them before submitting a prompt. The existing `prompt` alias
accepted task text but required `--requires`, which made the human workflow
discoverability poor.

Switchyard also needs to remain deterministic and scriptable. Interactive
questions must not appear in JSON, CI, or non-TTY execution.

## Decision

- When `prompt` runs in an interactive terminal without explicit
  `--requires`, load the registry and refresh discovery when it is missing or
  stale.
- Aggregate observed normalized capabilities across all discovered profiles,
  deduplicate them, and present them in stable vocabulary order.
- Present a checkbox-style numbered list with concise capability descriptions;
  provider names and raw provider-specific inventory are not part of selection.
- Require at least one selected capability, then pass the selection through the
  existing deterministic `run` routing path.
- Require explicit `--requires` for `run`, JSON output, CI, and non-TTY prompt
  usage. These paths never read interactive input.

## Consequences

- Human users discover available routing requirements at the point of use.
- Provider identity remains an implementation detail during capability
  selection.
- Prompt execution may perform discovery before selection when local state is
  absent or stale.
- Automation keeps a stable, non-interactive contract and can continue to
  supply exact requirements.
- The normalized vocabulary remains the routing boundary; raw provider
  capabilities are not silently promoted into selectable requirements.

## Alternatives considered

- **Require users to memorize capability names:** Rejected because it makes
  prompt routing undiscoverable.
- **Show provider-specific capability lists:** Rejected because users should
  choose requirements, not vendors, and provider labels are not the routing
  contract.
- **Prompt in JSON or non-TTY mode:** Rejected because it would hang or corrupt
  automation output.
- **Automatically select every discovered capability:** Rejected because it
  would over-constrain routing and produce surprising no-match results.
