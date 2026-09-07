# Changelog

All notable user-facing changes to Switchyard are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/).

## [Unreleased]

- Implemented the `discover` and `capabilities` commands with versioned JSON
  output, plain-text presentation, per-user registry path resolution, cached
  discovery refreshes, verified-capability filtering, and redacted diagnostics.
- Centralized human and JSON command serializers so CLI output uses the same
  versioned payload and redaction rules.

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
