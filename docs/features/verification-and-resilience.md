# Feature: Verification and Resilience

## Traceability

| Feature ID | Original PRD ID | Description |
|-----------|----------------|-------------|
| VERI-US-01 | US-07 | Verify advertised capabilities |
| VERI-US-02 | US-11 | Opt into fallback behavior |
| VERI-FR-01 | FR-13 | Prefer verified capabilities |
| VERI-FR-02 | FR-14 | Support preferred-harness and fallback controls |

**Product Vision:** [docs/product-vision.md](../product-vision.md)  
**Original PRD:** [docs/PRD.md](../PRD.md)

## 1. Feature Overview

**Feature Name:** Verification and Resilience  
**ID Prefix:** VERI  
**Summary:** Tests advertised capabilities safely and allows explicit fallback when preferred execution is unavailable.  
**Dependencies:** Discovery and Registry; Deterministic Routing and Explainability  
**Priority:** Should

## 2. User Stories

| ID | As a... | I want to... | So that... | Priority |
|----|---------|-------------|-----------|----------|
| VERI-US-01 | Local Developer | verify advertised capabilities | routing reflects what works here | Should |
| VERI-US-02 | Workflow Author | opt into fallback | resilience is controlled | Should |

## 3. Functional Requirements

| ID | Requirement | Priority |
|----|-------------|----------|
| VERI-FR-01 | Prefer verified capabilities over merely discovered capabilities when equivalent | Should |
| VERI-FR-02 | Support explicit preferred-harness and fallback policy controls | Should |

## 4. UI / Interaction Design

`switchyard verify [--harness=<id>] [--capability=<name>]` runs bounded policy-controlled probes. `run --preferred-harness=<id> --allow-fallback` enables fallback explicitly. The routing result reports the preferred qualification check and the selected qualifying fallback attempt; no fallback candidate is selected when fallback is omitted.

## 5. Implementation Tasks

### Phase 1: Probes
- [x] Define read-only and mutating probe policies.
- [x] Add verification result schema and timestamps.
- [x] Implement bounded adapter probes.

### Phase 2: Routing Integration
- [x] Include verification state in candidate ranking.
- [x] Implement explicit preferred-harness and fallback policy.
- [ ] Add warnings for probes that may incur cost or external access.

## 6. Testing Strategy

| Level | Scope | Approach |
|-------|-------|----------|
| Unit Tests | Verification state and ranking | Profile fixtures with mixed states |
| Integration Tests | Probe command and fallback | Stub adapters with controlled failures |
| Security Tests | Mutation and secret policies | Policy fixtures and redaction assertions |

Key test scenarios:
1. Verified and discovered candidates are ranked correctly.
2. A probe times out safely.
3. Fallback is disabled by default.
4. Explicit fallback tries only qualifying alternatives and reports the
   preferred and selected attempts.
5. Mutating probes require policy approval.

## Probe safety policy

Verification is deny-by-default for anything beyond a bounded, non-interactive
read-only probe. A probe declares its risk classes before the adapter is
called. `read-only` probes are allowed by default; `mutating`,
`external-access`, `paid`, and `model-invoking` probes are skipped unless the
corresponding policy approval is explicitly enabled. A rejected probe produces
an inspectable `skipped` result with a timestamp rather than disappearing.

Policy can be configured globally or per harness using
`allowMutatingProbes`, `allowExternalAccess`, `allowPaidProbes`, and
`allowModelInvocation` (all default to `false`). Warnings contain only fixed
risk descriptions: command arguments, environment values, prompts, and
secrets are never included. Verification runners apply a default five-second
timeout (or the adapter context's positive `timeoutMs`), pass an abort signal
to the adapter, and return a `timed-out` result for every in-flight capability
if the adapter does not finish. Probe runners bound output and time through
the adapter context and do not alter routing or fallback decisions.

## 7. Acceptance Criteria

1. Verification results are bounded, persisted, and inspectable.
2. Verified matches outrank equivalent unverified matches.
3. Fallback never occurs without explicit enablement.
4. Probe cost, mutation, and external-access risks are surfaced.
5. Failed probes do not erase unrelated registry entries.

## 8. Open Questions

| # | Question | Default Assumption |
|---|----------|--------------------|
| 1 | Which probes invoke models? | None by default; model-invoking probes require explicit opt-in |
