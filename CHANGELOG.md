# Changelog

All notable user-facing changes to Switchyard are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/).

## [Unreleased]

- Implemented the `discover` and `capabilities` commands with versioned JSON
  output, plain-text presentation, per-user registry path resolution, cached
  discovery refreshes, verified-capability filtering, and redacted diagnostics.
- Centralized human and JSON command serializers so CLI output uses the same
  versioned payload and redaction rules.
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
