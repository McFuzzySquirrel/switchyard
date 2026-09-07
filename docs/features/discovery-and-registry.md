# Feature: Discovery and Registry

## Traceability

| Feature ID | Original PRD ID | Description |
|-----------|----------------|-------------|
| DISC-US-01 | US-01 | Discover installed harnesses |
| DISC-US-02 | US-02 | Inspect normalized capabilities |
| DISC-FR-01 | FR-01 | Locate configured executables |
| DISC-FR-02 | FR-02 | Query versions |
| DISC-FR-03 | FR-03 | Query help metadata |
| DISC-FR-04 | FR-04 | Parse commands and flags |
| DISC-FR-05 | FR-05 | Normalize capabilities |
| DISC-FR-06 | FR-06 | Record discovery evidence |
| DISC-FR-07 | FR-07 | Persist registry atomically |
| DISC-FR-08 | FR-08 | Refresh registry entries |
| DISC-FR-09 | FR-09 | Report unavailable or malformed harnesses |

**Product Vision:** [docs/product-vision.md](../product-vision.md)  
**Original PRD:** [docs/PRD.md](../PRD.md)

## 1. Feature Overview

**Feature Name:** Discovery and Registry  
**ID Prefix:** DISC  
**Summary:** Finds configured harnesses, extracts advertised capabilities, and stores inspectable local profiles.  
**Dependencies:** None  
**Priority:** Must

## 2. User Stories

| ID | As a... | I want to... | So that... | Priority |
|----|---------|-------------|-----------|----------|
| DISC-US-01 | Local Developer | discover installed harnesses | I know what execution options are available | Must |
| DISC-US-02 | Local Developer | inspect normalized capabilities | I understand harness strengths | Must |

## 3. Functional Requirements

| ID | Requirement | Priority |
|----|-------------|----------|
| DISC-FR-01 | Locate configured executables through PATH and overrides | Must |
| DISC-FR-02 | Query versions non-interactively | Must |
| DISC-FR-03 | Capture help/capability metadata with bounds | Must |
| DISC-FR-04 | Parse documented commands and flags | Must |
| DISC-FR-05 | Normalize observations into a versioned vocabulary | Must |
| DISC-FR-06 | Record status, evidence, timestamps, paths, and versions | Must |
| DISC-FR-07 | Persist and reload registry atomically | Must |
| DISC-FR-08 | Refresh individual or all entries | Should |
| DISC-FR-09 | Report unavailable/malformed tools without discarding other results | Must |

## 4. UI / Interaction Design

`switchyard discover [--refresh] [--json]` reports each configured harness, executable path, version, discovered capabilities, and status. `switchyard capabilities [--verified] [--json]` reads the registry without launching a task. Registry-reading commands use a versioned JSON payload (`schemaVersion: 1`) and equivalent plain-text output; `--registry`, `SWITCHYARD_REGISTRY_PATH`, and `registryPath` in the selected configuration file choose the local registry, while `--config`/`SWITCHYARD_CONFIG_PATH` selects that configuration file.

## 5. Implementation Tasks

### Phase 1: Discovery Core
- [ ] Define registry and capability observation schemas.
- [ ] Implement cross-platform executable lookup.
- [ ] Implement bounded version/help probing.
- [ ] Add OpenCode and Copilot discovery adapters.
- [ ] Implement parser fixtures for supported CLI output.

### Phase 2: Persistence and Commands
- [ ] Implement atomic registry reads/writes.
- [x] Implement refresh and stale-entry handling.
- [x] Implement `discover` and `capabilities`.
- [x] Add human and JSON output.

## 6. Testing Strategy

| Level | Scope | Approach |
|-------|-------|----------|
| Unit Tests | Lookup, parsing, normalization, schema validation | Synthetic CLI output fixtures |
| Integration Tests | Registry and command behavior | Temporary directories and stub executables |
| Cross-Platform | PATH and command shim behavior | Linux, macOS, and Windows CI/manual checks |

Key test scenarios:
1. Supported executable is found and parsed.
2. Executable is missing or exits unsuccessfully.
3. Help output is malformed or changes unexpectedly.
4. Registry write is interrupted.
5. JSON and human output report the same profile data.

## 7. Acceptance Criteria

1. OpenCode and Copilot are discovered when available on PATH.
2. Missing tools produce actionable unavailable statuses.
3. Profiles contain evidence, version, executable path, capabilities, and timestamps.
4. Registry writes are atomic and reloadable.
5. Discovery results remain available when one harness fails.
6. Human and JSON inspection commands work non-interactively.
7. Command diagnostics are redacted and JSON output remains parseable with stable exit categories (`0` success, `1` partial discovery, `2` usage, `3` persistence/command failure).

## 8. Open Questions

| # | Question | Default Assumption |
|---|----------|--------------------|
| 1 | Should help parsing support shell completion metadata? | Defer until help parsing is insufficient |
| 2 | How long should cached profiles remain fresh? | Mark stale after a configurable interval and refresh on demand |
