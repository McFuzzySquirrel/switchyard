# Skill Audit Report

**Generated:** 2026-09-07
**Audited by:** `skill-review`
**Skills audited:** 3

---

## Summary Scores

| Skill | Context economy | Gotchas coverage | Procedural clarity | Progressive disclosure | Calibration | Validation | Overall |
|-------|---|---|---|---|---|---|---------|
| `safe-subprocess-fixtures` | 3 | 2 | 2 | 3 | 2 | 2 | 2.3 |
| `adapter-conformance` | 3 | 3 | 2 | 3 | 2 | 2 | 2.5 |
| `versioned-cli-contracts` | 3 | 3 | 2 | 3 | 2 | 2 | 2.5 |

**Score interpretation:**
- 2.5–3.0: Strong - follows best practices well
- 1.5–2.4: Adequate - works but has improvement opportunities
- 1.0–1.4: Needs work - significant gaps against best practices

---

## Notes

The three new skills passed the required structural gate and every quality axis met the `--min-axis 2` threshold. The review output retained the project-focused content and progressive-disclosure pattern required for Switchyard-specific workflow tasks.

### Passing skill set

- `.github/skills/safe-subprocess-fixtures/`
- `.github/skills/adapter-conformance/`
- `.github/skills/versioned-cli-contracts/`

The audit command used:

```bash
cd /home/mcfuzzysquirrel/Projects/switchyard
npm --prefix .github/skills/skill-review run skill-review -- --files .github/skills/safe-subprocess-fixtures/SKILL.md .github/skills/adapter-conformance/SKILL.md .github/skills/versioned-cli-contracts/SKILL.md --provider stdout --min-score 2 --fail-below --min-axis 2 --fail-axis-below --fail-structural
```
