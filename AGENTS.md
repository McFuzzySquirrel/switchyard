# Agent Instructions

## Documentation is part of the change

Before completing any change, determine whether it affects users, supported behavior, setup, CLI usage, architecture, or project direction. Keep the canonical documents aligned with the result:

| Change impact | Required documentation |
| --- | --- |
| User-facing behavior, supported capabilities, setup, commands, or examples | Review and update `README.md` |
| User-visible feature, fix, breaking change, or release-relevant behavior | Add an entry to `CHANGELOG.md` |
| A significant architectural or cross-cutting design decision | Add or update a numbered ADR in `docs/adr/` |
| Internal-only refactor with no user-visible or architectural impact | No documentation entry is required |

When more than one row applies, update every applicable document. Do not mark documentation work complete by merely describing a future update in a commit message.

## Canonical locations and formats

- `README.md` is the public project overview and usage guide.
- `CHANGELOG.md` follows the Keep a Changelog-style `Unreleased` and version sections.
- ADRs use `docs/adr/NNNN-short-title.md`, with four digits and a kebab-case title.
- Copy the relevant starting structure from `docs/templates/` rather than inventing a competing format.
- Keep links relative and examples accurate for the current implementation. If a document describes planned behavior, label it as planned and link to the source PRD.

## ADR workflow

Create an ADR when a decision changes a public contract, module boundary, persistence or execution model, security/privacy posture, or an extensibility strategy. Each ADR must record its status, context, decision, consequences, and alternatives considered. Update an existing ADR only when correcting or superseding the decision; do not silently rewrite history.

## Completion checks

Run the focused documentation check after documentation changes:

```sh
npm run test:docs
```

Run the normal project checks for code changes as well:

```sh
npm test
npm run typecheck
```
