# Feature: Harness Execution Runtime

## Traceability

| Feature ID | Original PRD ID | Description |
|-----------|----------------|-------------|
| EXEC-US-01 | US-04 | Run a task through a selected harness |
| EXEC-US-02 | US-06 | Run non-interactively |
| EXEC-US-03 | US-10 | Receive actionable errors |
| EXEC-US-04 | US-12 | Consume machine-readable results |
| EXEC-FR-01 | FR-17 | Execute with working-directory/environment controls |
| EXEC-FR-02 | FR-18 | Capture execution results |
| EXEC-FR-03 | FR-19 | Timeout and cancellation |
| EXEC-FR-04 | FR-20 | Human and JSON output |
| EXEC-FR-05 | FR-24 | Reject unsupported adapter operations |
| EXEC-FR-06 | FR-27 | Stable categorized exit codes |
| EXEC-FR-07 | FR-29 | Dry-run/explain-only mode |

**Product Vision:** [docs/product-vision.md](../product-vision.md)  
**Original PRD:** [docs/PRD.md](../PRD.md)

## 1. Feature Overview

**Feature Name:** Harness Execution Runtime  
**ID Prefix:** EXEC  
**Summary:** Runs routed tasks safely through adapters and returns complete, scriptable results.  
**Dependencies:** Discovery and Registry; Deterministic Routing and Explainability  
**Priority:** Must

## 2. User Stories

| ID | As a... | I want to... | So that... | Priority |
|----|---------|-------------|-----------|----------|
| EXEC-US-01 | Local Developer | run a task through a selected harness | the work is performed by a suitable tool | Must |
| EXEC-US-02 | Team Maintainer | run non-interactively | automation can use the CLI | Must |
| EXEC-US-03 | Local Developer | receive actionable errors | failures are diagnosable | Must |
| EXEC-US-04 | Team Maintainer | consume machine-readable results | workflows can automate outcomes | Should |

## 3. Functional Requirements

| ID | Requirement | Priority |
|----|-------------|----------|
| EXEC-FR-01 | Execute with working directory and environment controls | Must |
| EXEC-FR-02 | Capture stdout, stderr, status, duration, and failure category | Must |
| EXEC-FR-03 | Terminate processes and descendants on timeout/cancellation | Must |
| EXEC-FR-04 | Provide human and stable JSON results | Should |
| EXEC-FR-05 | Reject unsupported adapter operations before launch | Must |
| EXEC-FR-06 | Distinguish success, no-match, invalid-input, unavailable, and execution failures | Must |
| EXEC-FR-07 | Support dry-run without launching the task | Should |

## 4. UI / Interaction Design

`switchyard run --requires=... [--json] "<task>"` emits selection and execution status. Human diagnostics go to stderr while machine-readable result data goes to stdout. `--dry-run` or `explain` must not launch a harness.

## 5. Implementation Tasks

### Phase 1: Process Runner
- [x] Implement adapter execution request/result types.
- [ ] Implement bounded asynchronous process execution.
- [ ] Implement timeout, cancellation, and descendant cleanup.
- [ ] Implement environment filtering and output capture.

The vendor-neutral execution contract is defined in
`src/harness/adapter.ts`. `ExecutionRequest` carries the task, controlled
working directory, explicit environment values and inheritance policy, safe
stdin transport, timeout/output bounds, cancellation signal, non-interactive
mode, and dry-run intent. `ExecutionResult` reports lifecycle status, stable
failure category, nullable exit code, termination signal, bounded stdout and
stderr with per-stream truncation flags, duration, and an optional redacted
diagnostic. These types describe the process boundary; adapter modules remain
responsible for translating a normalized task into vendor-specific arguments
or stdin without shell interpolation.

### Phase 2: CLI Integration
- [ ] Connect routing to adapter execution.
- [ ] Define exit-code taxonomy.
- [ ] Add human/JSON result serializers.
- [ ] Add dry-run mode.

## 6. Testing Strategy

| Level | Scope | Approach |
|-------|-------|----------|
| Unit Tests | Result classification and serializers | Synthetic result fixtures |
| Integration Tests | Adapter launch and CLI behavior | Stub executables |
| Process Tests | Timeout, cancellation, output limits, descendants | Cross-platform child-process fixtures |

Key test scenarios:
1. Successful execution captures all result fields.
2. Non-zero exit preserves stderr and category.
3. Timeout cleans up descendants.
4. Cancellation is distinguishable from execution failure.
5. Dry-run never launches a child.

## 7. Acceptance Criteria

1. A routed task executes with configured cwd and environment.
2. Output, status, duration, and failure category are captured.
3. Timeout and cancellation do not leave child processes running.
4. Unsupported operations fail before launch.
5. Exit codes are stable and documented.
6. JSON output is parseable on success and failure.

## 8. Open Questions

| # | Question | Default Assumption |
|---|----------|--------------------|
| 1 | Should prompts be sent through argv or stdin? | Adapter chooses the safest supported transport |
