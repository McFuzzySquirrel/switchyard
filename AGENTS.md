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

## Documentation workflow

Use the repository `create-project-documentation` skill for documentation
audits, new documentation, documentation refreshes, release preparation, and
cross-document consistency work:

```text
.github/skills/create-project-documentation/SKILL.md
```

Follow that skill's inventory, evidence, scope/version, navigation, and
validation process. Load its reference template for each artifact being
created or substantially refreshed. Document implemented behavior separately
from roadmap or aspirational behavior, and do not claim live integrations or
production support without repository evidence.

## Local workflow-engine state

Workflow-engine and authoring outputs under `docs/` are local-only. They may
contain prompts, repository paths, provider diagnostics, execution traces, or
generated task artifacts, so do not add them to commits or paste their contents
into public documentation. The repository `.gitignore` lists the generated
categories; retain canonical requirements, feature, ADR, README, guide, and
prompt-playbook documents.

## Canonical locations and formats

- `README.md` is the public project overview and usage guide.
- `CHANGELOG.md` follows the Keep a Changelog-style `Unreleased` and version sections.
- ADRs use `docs/adr/NNNN-short-title.md`, with four digits and a kebab-case title.
- Use the applicable templates from `.github/skills/create-project-documentation/references/`.
- Keep links relative and examples accurate for the current implementation. If a document describes planned behavior, label it as planned and link to the source PRD.

## ADR workflow

Create an ADR when a decision changes a public contract, module boundary, persistence or execution model, security/privacy posture, or an extensibility strategy. Each ADR must record its status, context, decision, consequences, and alternatives considered. Update an existing ADR only when correcting or superseding the decision; do not silently rewrite history.

## Completion checks

Run the focused documentation check after documentation changes:

```sh
npm run test:docs
```

Also run the documentation skill's validation checklist and `git diff --check`,
including local Markdown-link, command, configuration-name, version, and
secret-leakage checks where applicable.

Run the normal project checks for code changes as well:

```sh
npm test
npm run typecheck
```
