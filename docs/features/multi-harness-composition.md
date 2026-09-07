# Feature: Multi-Harness Composition

## Traceability

| Feature ID | Original PRD ID | Description |
|-----------|----------------|-------------|
| COMP-US-01 | US-08 | Compose implementation and review stages |
| COMP-FR-01 | FR-21 | Run implementation-plus-review workflow |
| COMP-FR-02 | FR-22 | Pass declared artifacts/context |
| COMP-FR-03 | FR-23 | Preserve stage-level results |

**Product Vision:** [docs/product-vision.md](../product-vision.md)  
**Original PRD:** [docs/PRD.md](../PRD.md)

## 1. Feature Overview

**Feature Name:** Multi-Harness Composition  
**ID Prefix:** COMP  
**Summary:** Runs multiple specialized harnesses in a declared workflow and preserves stage outputs and failures.  
**Dependencies:** Harness Execution Runtime; Adapter Extensibility and Configuration  
**Priority:** Should

## 2. User Stories

| ID | As a... | I want to... | So that... | Priority |
|----|---------|-------------|-----------|----------|
| COMP-US-01 | Workflow Author | compose implementation and review stages | specialized harnesses contribute to one workflow | Should |

## 3. Functional Requirements

| ID | Requirement | Priority |
|----|-------------|----------|
| COMP-FR-01 | Run an implementation-plus-review workflow across two adapters | Should |
| COMP-FR-02 | Pass explicitly declared artifacts or context between stages | Should |
| COMP-FR-03 | Preserve stage-level results when a later stage fails | Should |

## 4. UI / Interaction Design

`switchyard compose <workflow-file> [--json]` executes sequential stages. Each stage identifies requirements, task input, declared outputs, and the next stage's inputs. The command reports stage boundaries and final status.

## 5. Implementation Tasks

### Phase 1: Workflow Model
- [x] Define workflow and stage schemas.
- [x] Define declared artifact/context handoff.
- [x] Validate dependencies and stage ordering.
- [x] Validate unique input/output declarations and restrict context fields.
- [x] Validate artifact containment at schema time and re-check produced paths
  (including symlink resolution) at the receiving stage.

### Phase 2: Execution and Demonstration
- [x] Orchestrate sequential adapter calls.
- [x] Persist per-stage results.
- [ ] Implement OpenCode-to-Copilot implementation/review example.
- [x] Add partial-failure reporting.

## 6. Testing Strategy

| Level | Scope | Approach |
|-------|-------|----------|
| Unit Tests | Workflow validation and handoff | Schema and artifact fixtures |
| Integration Tests | Sequential stage execution | Stub adapters |
| Manual / Exploratory | Real two-harness demonstration | Reproducible example repository |

Key test scenarios:
1. Implementation output is passed to review.
2. Missing declared artifact stops the correct stage.
3. Review failure preserves implementation results.
4. Invalid workflow dependencies are rejected before launch.
5. Only requested artifact metadata and whitelisted stage context appear in
   the receiving task and persisted handoff manifest.

## 7. Acceptance Criteria

1. A workflow can declare at least two sequential harness stages.
2. OpenCode and Copilot can participate through their adapters when installed.
3. Only declared artifacts/context cross stage boundaries.
4. Every stage has an inspectable status and result.
5. Later-stage failure preserves earlier-stage output and diagnostics.

## 8. Open Questions

| # | Question | Default Assumption |
|---|----------|--------------------|
| 1 | Should opaque conversation continuation be transferred? | No; transfer declared files and metadata only |

## 9. Implementation Notes

The public composition API is exported from `src/composition/index.ts`:

- `validateWorkflow` / `assertWorkflow` validate stage identifiers, dependency
  ordering, cycles, unique declared inputs/outputs, whitelisted context,
  declared inputs/outputs, and workspace-contained artifact paths before any
  adapter is called.
- `executeWorkflow` runs stages in topological order through normalized
  `HarnessAdapter.execute` operations. Adapter selection is injectable so the
  existing routing policy can be reused by callers.
- Handoffs contain only requested artifact metadata and the explicitly
  requested stage context fields (`status`, `selectedHarness`, `durationMs`, or
  `diagnostic`). The exact sanitized manifest is retained on the receiving
  `CompositionStageResult.handoff` for inspection. Opaque conversation state,
  stdout/stderr, and process environment are never copied.
- Path-bearing file and directory artifacts are checked when a receiving stage
  is about to run. Missing, wrong-kind, or symlink-escaped paths fail that
  receiving stage without erasing the successful producer result. Dependent
  stages are recorded as skipped rather than losing their stage-level status.
- `switchyard-workflow-state.json` is updated after each stage and retains
  successful stage results and diagnostics when a later stage fails.
