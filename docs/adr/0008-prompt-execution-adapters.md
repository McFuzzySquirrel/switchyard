# ADR-0008: Direct prompt execution for built-in provider adapters

- **Status:** Accepted
- **Date:** 2026-09-08

## Context

Switchyard could discover OpenCode and GitHub Copilot and explain routing, but
the built-in adapters could not launch a selected provider. Users therefore had
no short path from a routing decision to observing an agent handle a prompt.
The existing `run` command already owns routing, request validation, process
limits, cancellation, and output redaction.

## Decision

- Keep `run` as the implementation boundary for routing and execution.
- Add `prompt` as a task-oriented CLI alias for `run`; it does not introduce a
  second routing policy or output schema.
- Mark built-in OpenCode and GitHub Copilot adapters as execution-capable for
  prompt execution only.
- Invoke OpenCode with `opencode run <prompt>` and GitHub Copilot with
  `copilot --prompt <prompt>`, using direct argument arrays and the shared
  bounded `executeProcess` runtime.
- Preserve unsupported states for verification, resume, and fork.
- Keep `--dry-run` as the safe way to inspect selection without launching a
  provider process.

## Consequences

- Users can see the complete discover, explain, preview, execute workflow with
  installed built-in providers.
- Provider-specific permissions and authentication remain provider concerns;
  Switchyard does not silently enable broad tool or path permissions.
- Prompt execution inherits shared timeout, cancellation, output-bound, and
  redaction behavior.
- The built-in adapters remain intentionally incomplete for lifecycle features
  that need provider-specific session semantics.

## Alternatives considered

- **Leave built-ins discovery-only:** Rejected because users could not observe a
  real routed agent run without writing a custom adapter.
- **Duplicate routing in a new prompt command:** Rejected because it would
  create divergent selection behavior; `prompt` is only an alias.
- **Use shell interpolation or provider-specific shell scripts:** Rejected
  because prompts and paths must remain isolated from shell interpretation.
- **Automatically enable all provider permissions:** Rejected because that
  would create an unsafe and surprising default for prompts that can modify
  repositories or access external services.
