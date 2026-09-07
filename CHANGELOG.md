# Changelog

All notable user-facing changes to Switchyard are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/).

## [Unreleased]

- Added versioned workflow and stage composition schemas with dependency-cycle
  validation, workspace-contained artifact declarations, explicit stage input
  handoffs, sequential execution, and durable per-stage results.
- Hardened composition handoff boundaries: input/output declarations are
  unique and validated before launch, only whitelisted context and requested
  artifact metadata are forwarded, receiving stages re-check artifact
  containment/kind (including symlink resolution), and persisted results retain
  sanitized handoff manifests plus earlier successes when a later stage fails.
- Added `switchyard verify` with selective harness/capability probes,
  atomic verification-state persistence, and fixed redacted warnings for
  probes that may access external services, invoke models, mutate state, or
  incur provider charges. Risky probes remain denied until their matching
  policy approval is explicitly enabled.
- Added a pure routing-policy decision layer for preferred harnesses and
  explicit fallback. A preferred harness can never bypass all-required
  capability matching, fallback remains disabled unless `allowFallback` or
  `--allow-fallback` is supplied, and `explain`/`run` now report the
  qualifying policy attempts in stable human and JSON output.
- Added `switchyard run --requires=<capabilities> [--json] [--dry-run]
  [--cwd PATH] [--timeout-ms MS] "<task>"`, connecting deterministic routing
  (`explain`) to adapter execution. `run` never reimplements matching or
  ranking: it selects a harness through `explain`, checks
  `adapter.supportedOperations.execute` before any process launch, and
  reports a missing or non-executing adapter as `status: "unavailable"`
  rather than throwing. Added the `RunCommandResult` status taxonomy
  (`success`, `dry-run`, `no-match`, `invalid-input`, `unavailable`,
  `execution-failure`) with versioned JSON output (`formatRunJson`) and a
  stable human presentation (`formatRunHuman`), and extended
  `CLI_EXIT_CODES` with `unavailable` (`5`); `no-match` (`4`),
  `invalid-input` (`2`), and generic `failure` (`3`) are reused from the
  existing exit-code taxonomy. See
  [ADR-0006](docs/adr/0006-run-command-execution-routing.md).
  Dry-run previews return a synthetic result after routing and never resolve
  or invoke an adapter.
- Centralized the stable CLI exit-code taxonomy and status-to-code mapping in
  `src/output/exit-codes.ts`, preserving codes `0` through `5` and the
  deprecated `usage` alias while documenting that timeout and cancellation
  remain nested execution categories under the generic execution-failure
  command exit.
- `--requires`, `--preferred-harness`, and `--allow-fallback` are now shared
  between `explain` and `run` instead of being explain-only options.
- Implemented the `discover` and `capabilities` commands with versioned JSON
  output, plain-text presentation, per-user registry path resolution, cached
  discovery refreshes, verified-capability filtering, and redacted diagnostics.
- Centralized human and JSON command serializers so CLI output uses the same
  versioned payload and redaction rules, including secret-bearing task text
  and captured execution output.
- Added the shared versioned command JSON envelope and routing-decision
  contract. `serializeCommandJson`, `parseCommandJson`, and
  `parseDecisionJson` are exported for script and library consumers, while
  `explain --json` preserves the schema-version-1 success, no-match, and
  invalid-input variants.
- Added `switchyard explain --requires=<capability,...> [--json]` with
  deterministic all-required matching, verified-before-discovered ranking,
  stable candidate explanations, explicit preferred-harness/fallback policy,
  and distinct invalid-input (`2`, `CLI_EXIT_CODES.invalidInput`) and
  no-match (`4`, `CLI_EXIT_CODES.noMatch`) exit categories.

### Added

- Added bounded verification adapter probes with cooperative cancellation,
  configurable timeouts, and explicit `timed-out` results for hanging probes.
- Added a versioned, runtime-validated verification result schema with
  capability status, bounded messages, and ordered `startedAt`/`completedAt`
  UTC timestamps.
- Added the bounded asynchronous process runtime (`executeProcess`/`runProcess`)
  with direct argv spawning, controlled environment inheritance, per-stream
  output limits, redacted diagnostics, timeout/cancellation classification,
  and process-tree cleanup.
- Clarified that an execution output limit of zero intentionally captures no
  output while preserving truncation metadata.
- Added the vendor-neutral execution request/result contract with controlled
  working-directory and environment-policy fields, safe stdin/cancellation
  inputs, bounded output metadata, lifecycle status, and stable failure
  categories.
- Added all-required capability matching with deterministic matched/missing
  diagnostics and boolean convenience predicates.
- Added deterministic capability ranking and selection: fully verified
  qualifying matches outrank discovered matches and equal-tier ties use the
  stable harness ID key; stale and discovery-only profiles cannot be promoted
  to the verified tier.
- Added the full, execute-capable `HarnessAdapter` contract with a shared
  `UnsupportedOperationError`/`assertOperationSupported`/
  `throwUnsupportedOperation` mechanism so every adapter fails an
  unsupported operation before any process launch, without adapter-specific
  branching.
- Added `HarnessAdapterRegistry` and explicit built-in `opencode`/`copilot`
  full adapters (`createOpenCodeAdapter`, `createGitHubCopilotAdapter`) that
  bind their resolved configuration once so discovery, verification,
  execution, resume, and fork all observe the same executable.
- Added `createStubHarnessAdapter`, a reusable conformance fixture
  implementing the full adapter contract without a vendor process, and an
  adapter-conformance test suite proving registration and fail-fast
  behavior require no matcher changes.
- Added a typed local configuration schema (`SwitchyardConfig`) covering
  registry location, default and per-harness probe policy, and per-harness
  executable overrides, with actionable, secret-safe field diagnostics on
  invalid input.
- Added configuration file loading (`loadSwitchyardConfig`,
  `readSwitchyardConfig`, `resolveConfigPath`, `defaultConfigPath`,
  `SWITCHYARD_CONFIG_PATH`) and per-field precedence resolution
  (`resolveHarnessRuntimeConfig`, `resolveEffectiveRegistryPath`) applying
  explicit-override > environment-variable > configuration-file > default
  consistently across executable, timeout, output-length, mutating-probe
  policy, and registry-path fields.
- Added deny-by-default verification probe policies: bounded read-only probes
  are allowed by default, while mutating, external-access, paid, and
  model-invoking probes require explicit approval and produce inspectable,
  timestamped skips when rejected.
- Normalized executable overrides into one resolved adapter field with a
  preserved source (`override` or `configured`), and made `capabilities` and
  `explain` honor the typed configuration file's registry location.
- Added `docs/adapter-development.md` covering adapter lifecycle,
  registration, testing, error handling, and security expectations, and
  ADR-0002 recording the adapter contract and configuration precedence
  design.
- Expanded adapter documentation with an explicit registration workflow,
  registry selection guidance, and the focused conformance-suite command for
  testing new adapters without a vendor installation.

### Added

- Initial discovery schemas, executable lookup, bounded version/help probing, and built-in OpenCode and GitHub Copilot CLI discovery adapters.
- Added the versioned `TaskRequirements` schema with normalized capability, preferred harness, fallback, and validation contracts.
- Added validated local registry reads and atomic, interruption-resilient JSON writes with user-only file permissions.
- Added configurable stale-entry marking and resilient single/all-adapter registry refresh APIs that retain unrelated cached profiles when a probe fails.
- Repository documentation governance through `AGENTS.md`, canonical templates, and a focused documentation check.

### Fixed

- Prevented repeated manifest-reconciliation notices from accumulating in workflow state and obscuring progress reporting.

## [0.1.0] - 2026-09-07

### Added

- Initial Switchyard package structure and capability-driven harness discovery foundation.
