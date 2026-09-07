# Feature: Deterministic Routing and Explainability

## Traceability

| Feature ID | Original PRD ID | Description |
|-----------|----------------|-------------|
| ROUT-US-01 | US-03 | Declare capability requirements |
| ROUT-US-02 | US-05 | Understand selection decisions |
| ROUT-FR-01 | FR-10 | Accept task requirements |
| ROUT-FR-02 | FR-11 | Match required capabilities |
| ROUT-FR-03 | FR-12 | Rank candidates deterministically |
| ROUT-FR-04 | FR-15 | Fail clearly when no candidate qualifies |
| ROUT-FR-05 | FR-16 | Explain candidate and selection data |

**Product Vision:** [docs/product-vision.md](../product-vision.md)  
**Original PRD:** [docs/PRD.md](../PRD.md)

## 1. Feature Overview

**Feature Name:** Deterministic Routing and Explainability  
**ID Prefix:** ROUT  
**Summary:** Matches task requirements against registered profiles and produces reproducible, inspectable selections.  
**Dependencies:** Discovery and Registry  
**Priority:** Must

## 2. User Stories

| ID | As a... | I want to... | So that... | Priority |
|----|---------|-------------|-----------|----------|
| ROUT-US-01 | Workflow Author | declare required capabilities | tasks are routed by needs | Must |
| ROUT-US-02 | Local Developer | see why a harness was selected | I can trust and debug routing | Must |

## 3. Functional Requirements

| ID | Requirement | Priority |
|----|-------------|----------|
| ROUT-FR-01 | Accept requirements through CLI flags and machine-readable workflows | Must |
| ROUT-FR-02 | Reject candidates missing any required capability | Must |
| ROUT-FR-03 | Rank qualifying candidates with documented deterministic rules | Must |
| ROUT-FR-04 | Return actionable no-match errors | Must |
| ROUT-FR-05 | Explain requirements, matches, missing capabilities, scores, and selection | Must |

## 4. UI / Interaction Design

`switchyard explain --requires=<capability,...> [--json]` performs selection without execution. Output lists requirements, each candidate's match state, ranking inputs, and the selected harness.

The command reads the cached registry only. It requires at least one
normalized capability, matches every requirement (not any requirement), and
uses the shared ranking policy: fully verified matches first, discovered-only
matches second, then ascending harness ID. `--preferred-harness=<id>` selects
that harness only when it qualifies; fallback is disabled unless
`--allow-fallback` is supplied. A successful explanation exits `0`; a
non-qualifying request exits `4` (`noMatch`); malformed requirements use the
invalid-input exit `2` (`invalidInput`). Human and JSON output carry the same decision data, and JSON uses the
versioned command schema (`schemaVersion: 1`). The shared output contract
requires the stable `schemaVersion`, `command`, and `status` envelope; the
explain-specific fields remain command-owned and additive for compatibility.
Library consumers can use `parseDecisionJson` to validate the explain
discriminator and status before reading candidate details.

## 5. Implementation Tasks

### Phase 1: Matching
- [x] Define requirement schema and validation.
- [x] Implement all-required capability matching.
- [x] Implement deterministic tie-breaking.

### Phase 2: Explainability
- [x] Implement human-readable explanation output.
- [x] Implement stable JSON decision schema.
- [x] Define no-match and invalid-input exit codes.

## 6. Testing Strategy

| Level | Scope | Approach |
|-------|-------|----------|
| Unit Tests | Matching, ranking, validation | Table-driven profile fixtures |
| Integration Tests | Explain command and exit codes | CLI subprocess tests |

Key test scenarios:
1. Exactly one candidate qualifies.
2. Multiple candidates tie and resolve consistently.
3. A candidate is missing one required capability.
4. No candidate qualifies.
5. JSON explanation is stable and complete.

## 7. Acceptance Criteria

1. Requirements can be supplied through supported input forms.
2. No candidate missing a required capability is selected.
3. Identical inputs always produce identical selection.
4. No-match and invalid-input cases have distinct errors.
5. Explanation output identifies the selected harness and reason.

## 8. Open Questions

| # | Question | Default Assumption |
|---|----------|--------------------|
| 1 | Should users be able to require a preferred harness? | Defer preference policy to Adapter Configuration and use capability matching here |
