# ADR-0007: Normalized routing capabilities and provider feature inventory

- **Status:** Accepted
- **Date:** 2026-09-08

## Context

Provider help output contains more useful feature information than the small
vendor-neutral vocabulary currently needed for routing. Treating the shared
vocabulary as the complete provider surface caused discovery to discard
provider-specific commands, options, providers, and help topics. At the same
time, persisting every vendor label as a routable capability would make
routing unstable and vendor-coupled.

OpenCode and GitHub Copilot are the first built-in providers. Their help output
can be long enough that the previous default probe bound of `8192` characters
truncated features before parsing.

## Decision

- Keep `capabilities` as the closed, normalized vocabulary used by matching and
  deterministic routing.
- Add optional `providerCapabilities` to `HarnessProfile` for structured,
  provider-specific inventory. Each entry records an identifier, label, kind,
  observation timestamp, and bounded help evidence.
- Support provider inventory kinds for commands, options, provider labels, and
  help topics. Unknown provider features remain informational until explicitly
  mapped to the normalized vocabulary.
- Parse structured sections from bounded provider help output and allow each
  adapter to add provider-specific observations when needed.
- Increase the default probe output bound to `32768` characters while retaining
  explicit per-harness and call-time limits.
- Preserve separate discovery and verification states. Provider inventory is
  discovery evidence and does not imply that a runtime operation is verified.

## Consequences

- Consumers can inspect the provider feature surface without depending on
  vendor-specific parser internals.
- Routing remains deterministic and vendor-neutral because only normalized
  capabilities qualify candidates.
- Persisted profiles become more informative and slightly larger.
- Longer help output is available to parsers by default, increasing bounded
  discovery memory and output costs while remaining configurable.
- Adding a provider-specific label does not silently expand the routing
  contract; normalized vocabulary changes remain deliberate and testable.

## Alternatives considered

- **Discard unknown provider features:** Rejected because users could not see
  why a provider supports a feature that routing does not yet understand.
- **Persist every provider label as a normalized capability:** Rejected because
  vendor-specific labels would leak into routing and make requirements
  non-portable.
- **Use only a larger raw help excerpt:** Rejected because consumers would
  need to parse unstable vendor text themselves and could not reliably inspect
  commands or options.
- **Probe every provider subcommand automatically:** Rejected because it can
  trigger side effects, prompts, network access, or provider charges. Runtime
  verification remains explicit and policy-controlled.
