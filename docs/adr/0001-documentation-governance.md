# ADR-0001: Establish documentation governance

- **Status:** Accepted
- **Date:** 2026-09-07

## Context

Switchyard has a PRD and generated workflow documentation, but it did not have a consistent contributor-facing rule for maintaining public project documentation or recording architectural decisions. Relying on memory makes documentation drift likely, while requiring every internal refactor to update release documents creates noise.

## Decision

Use a root `AGENTS.md` as the contributor and agent-facing policy. Keep the public README and changelog at the repository root, and store one numbered Markdown ADR per significant architectural decision under `docs/adr/`. Require README review for user-facing behavior, changelog entries for release-relevant user-visible changes, and ADRs for significant architectural decisions. Use reusable templates and a focused test to validate the canonical document structure.

## Consequences

- Documentation responsibilities are explicit for agent-driven changes.
- Public documentation remains easy to find at the repository root.
- ADR history is append-oriented and independently reviewable.
- The focused check detects missing or malformed canonical documents, but policy compliance still requires reviewing the change’s impact.
- Internal-only changes do not create changelog noise unless they alter supported behavior or architecture.

## Alternatives considered

- **Instructions only:** Rejected because instructions without templates or a structural check make omissions harder to detect.
- **One cumulative ADR file:** Rejected because independent, numbered decisions are easier to review, link, and supersede.
- **CI-only enforcement:** Rejected as the sole mechanism because CI can validate structure but cannot reliably infer whether a code change is user-facing or architectural.
