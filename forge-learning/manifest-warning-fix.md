# Manifest Warning Fix: MyForge Upstream Learning

## Executive summary

Manifest creation produced 41 warnings:

- 36 warnings said a task had a weak owner match.
- 5 warnings said a feature depended on another feature, but no phases were
  emitted for that dependency.

The warnings came from two separate compiler issues:

1. **Feature dependency references were parsed too literally.** The product
   vision used table values such as `Feature 1` and `Features 1 and 2`, while
   the compiler's dependency graph expected exact feature names such as
   `Discovery and Registry`.
2. **Task ownership matching did not use enough declared agent context.** The
   scorer considered the agent name, description, collaboration, and
   constraints, but omitted the agent's full body and the feature currently
   being compiled. Generic terms such as `implement`, `output`, `execution`,
   and `schema` therefore created ties or near-ties between valid specialists.

The implementation now:

- resolves numbered feature references to feature names before topological
  ordering;
- supports both singular and plural forms (`Feature 1`, `Features 1 and 2`);
- includes the agent's full declared body in ownership scoring;
- gives a feature-context bonus when an agent explicitly declares ownership of
  that feature;
- reports weak ownership only for an actual score tie rather than for every
  one-point margin;
- preserves the existing fallback and coordinator-exclusion behavior;
- adds a regression test for numbered dependency references.

On the Switchyard manifest, the five dependency warnings disappeared and the
ownership warnings dropped from 36 to 8. The remaining ownership warnings are
non-fatal ambiguity notices for tasks with genuinely overlapping specialist
responsibilities.

## Original symptoms

The product vision contains this feature table:

```markdown
| # | Feature | File | Dependencies | Priority |
|---|---------|------|-------------|----------|
| 1 | Discovery and Registry | ... | None | Must |
| 2 | Deterministic Routing and Explainability | ... | Feature 1 | Must |
| 3 | Harness Execution Runtime | ... | Features 1 and 2 | Must |
```

The compiler emitted warnings like:

```text
Feature 'Deterministic Routing and Explainability' depends on 'Feature 1',
but no phases were emitted for it.

Feature 'Harness Execution Runtime' depends on 'Features 1 and 2',
but no phases were emitted for it.
```

Those warnings were misleading. The feature files did exist and phases had
been compiled for them. The graph resolver simply looked up the literal
strings `Feature 1` and `Features 1 and 2` in a map keyed by feature names.

The ownership warnings looked like:

```text
Weak owner match for task
'[ ] Implement bounded asynchronous process execution.'
→ discovery-registry-engineer
```

The selected owner was often usable, but the warning indicated that the
scoring algorithm could not distinguish the intended specialist confidently.
This produced warning noise and made it difficult to identify real ownership
problems.

## Root cause 1: dependency alias mismatch

### Existing behavior

The original dependency parsing logic split a dependency cell only on commas
or plus signs and retained the text as-is:

```ts
const dependencies = (depsCell ?? "None")
  .split(/\s*(?:\+|,)\s*/)
  .map((dep) => dep.trim())
  .filter((dep) => dep && dep.toLowerCase() !== "none");
```

The topological sorter then performed an exact lookup:

```ts
const depNode = byName.get(dep);
```

For a row containing `Feature 1`, `byName.get("Feature 1")` returned
`undefined` because the map contained `Discovery and Registry`, not the
numeric alias.

### Why this matters

The warning did not merely add noise. The feature graph is also used to set
phase dependencies. An unresolved dependency can make phases appear
independent when they should be ordered, or can leave the manifest without
the intended cross-feature gating.

### Fix implemented

The parser now performs these steps:

1. Preserve the table number, feature name, file cell, and dependency cell for
   every valid row.
2. Build a `number -> feature name` map.
3. Parse dependency values in two modes:
   - `None` becomes an empty dependency list.
   - `Feature N` and `Features N and M` are converted through the number map.
   - Existing name-based and comma/plus-separated references remain supported.
4. Store canonical feature names in `FeatureNode.dependencies`.

The relevant logic is conceptually:

```ts
const namesByNumber = new Map<string, string>();

for (const row of rows) {
  const number = row.number.match(/\d+/)?.[0];
  if (number) namesByNumber.set(number, row.name);
}

const resolveDependencies = (value: string): string[] => {
  if (value.trim().toLowerCase() === "none") return [];

  const references = [...value.matchAll(/features?\s+([\d\s,and]+)/gi)]
    .flatMap((match) => match[1]!.match(/\d+/g) ?? []);

  if (references.length > 0) {
    return [...new Set(
      references
        .map((number) => namesByNumber.get(number))
        .filter((name): name is string => Boolean(name)),
    )];
  }

  return value
    .split(/\s*(?:\+|,)\s*/)
    .map((dependency) => dependency.trim())
    .filter((dependency) => dependency && dependency.toLowerCase() !== "none");
};
```

The important invariant is that `FeatureNode.dependencies` contains canonical
feature names, regardless of whether the source table used numeric aliases or
names.

### Upstream implementation guidance

Apply this in the shared MyForge compiler, not only in the Switchyard copy.
The resolver should remain backward-compatible with:

- `None`;
- `Feature 1`;
- `Features 1 and 2`;
- `Feature 1 + Feature 2`;
- exact feature names;
- comma-separated exact feature names.

Unknown numeric references should remain visible as warnings rather than being
silently discarded. The current Switchyard input is valid, so all references
resolve; MyForge should still emit a targeted diagnostic for malformed future
input.

## Root cause 2: weak ownership scoring

### Existing behavior

Ownership scoring tokenized the task and these agent fields:

- agent name;
- frontmatter description;
- `Expertise`;
- `Collaboration`;
- `Constraints`.

The full agent document body was available as `rawBody`, but it was not
included in the score. The scorer also had no knowledge of the feature whose
phase was being compiled.

The original ambiguity rule was:

```ts
if (best.score - second <= 1) {
  return {
    owner: best.agent.name,
    warning: `Weak owner match ...`,
  };
}
```

This treated both an exact tie and a one-point lead as weak. In a team where
multiple agents legitimately mention shared terms such as `execution`,
`output`, `schema`, `testing`, or `adapter`, one point is not sufficient
evidence of ambiguity.

### Why this matters

The compiler did not necessarily assign the wrong owner. The problem was that
the warning stream became dominated by expected overlap. That creates three
operational risks:

1. Real ownership defects are harder to notice.
2. Teams may incorrectly “fix” valid assignments just to suppress warnings.
3. Generated manifests look less trustworthy even when all tasks are
   assigned.

### Fix implemented: richer agent evidence

The scorer now includes `agent.rawBody` in the token set. This allows explicit
responsibility statements such as:

```markdown
You own the Discovery and Registry feature end to end.
```

and detailed responsibility bullets to influence matching.

### Fix implemented: feature context

Feature compilation passes the current feature name into task ownership
selection. If an agent's full body explicitly contains that feature name, the
agent receives a context bonus.

This is a tie-breaker, not a hard owner override. Task-specific language still
drives the main score, so cross-cutting tasks can remain assigned to another
specialist when its task vocabulary is stronger.

Conceptually:

```ts
function overlapScore(
  taskText: string,
  agent: AgentDescriptor,
  contextText = "",
): number {
  // Score task vocabulary against declared agent material.
  // ...

  if (contextText &&
      agent.rawBody.toLowerCase().includes(contextText.toLowerCase())) {
    score += 4;
  }

  return score;
}
```

The feature context is passed through:

```text
compileFeatureManifest
  -> extractTasks(..., feature.name)
  -> pushTask(..., ownerContext)
  -> chooseOwner(taskText, agents, ownerContext)
```

Synthesized tasks from functional requirements receive the same feature
context. Monolithic PRD compilation continues to work without a context value.

### Fix implemented: narrower weak-match threshold

The warning now appears only when the best score exactly equals the second-best
score:

```ts
if (best.score === second) {
  return { owner: best.agent.name, warning: "Weak owner match ..." };
}
```

A one-point lead is now accepted as a deterministic match. This is appropriate
for the current fuzzy scorer because:

- the selected owner remains deterministic;
- zero-score matches still use the existing explicit fallback warning;
- exact ties remain visible for review;
- feature context and full agent bodies provide stronger evidence before the
  threshold is evaluated.

### Upstream implementation guidance

The long-term MyForge implementation should consider making the evidence model
more explicit than token overlap alone. Recommended future improvements:

- expose score contributions in debug output;
- distinguish task vocabulary, feature ownership, and explicit requirement IDs;
- support explicit `owns` or `responsibilities` metadata in agent frontmatter;
- preserve a warning when no candidate has meaningful evidence;
- add a deterministic tie-break key independent of filesystem order.

The Switchyard fix is intentionally small and compatible with the existing
manifest schema.

## Files changed in the Switchyard implementation

| File | Change |
|---|---|
| `.github/skills/forge-execution-adapter/scripts/compiler.ts` | Added feature dependency alias resolution; enriched owner scoring; added feature context; narrowed weak-match detection. |
| `.github/skills/forge-execution-adapter/scripts/adapter.test.ts` | Added a regression test for `Feature 1` and `Features 1 and 2` dependency syntax. |
| `docs/EXECUTION-MANIFEST.json` | Regenerated manifest with corrected phase dependencies and reduced warnings. |
| `docs/agent-responsibility-matrix.md` | Regenerated responsibility matrix. |

The generated `docs/` files are build outputs. The reusable upstream changes
are the compiler and test changes.

## Regression test

The added test creates a feature table with numeric dependencies:

```markdown
| 1 | Foundation | ... | None |
| 2 | Expenses | ... | Feature 1 |
| 3 | Budgets | ... | Features 1 and 2 |
```

It asserts:

```ts
assert.deepEqual(manifest.featureOrder, [
  "Foundation",
  "Expenses",
  "Budgets",
]);

assert.deepEqual(
  manifest.phases.map((phase) => phase.dependencies),
  [
    [],
    ["FOUNDATION-1"],
    ["FOUNDATION-1", "EXPENSES-1"],
  ],
);

assert.doesNotMatch(
  manifest.warnings.join("\n"),
  /depends on 'Feature/,
);
```

This verifies both topological ordering and canonical phase dependency
generation.

## Validation performed

The execution-adapter package was validated with:

```bash
cd .github/skills/forge-execution-adapter
npm run typecheck
npm test
npm run forge-execution-adapter -- compile --harness-root .github
```

The final test run passed all 28 tests. Manifest compilation completed with:

- 0 unassigned tasks;
- 0 duplicate expected-output owners;
- 0 orphan implementation agents;
- 0 unresolved feature dependency warnings;
- 8 remaining weak-owner warnings for genuinely overlapping responsibilities.

## Recommended MyForge upstream change set

Implement the following in order:

1. **Canonicalize feature dependency references**
   - Add table-row numbering to the parsed feature model.
   - Build number-to-name aliases.
   - Normalize numeric and named dependencies before graph traversal.
   - Add diagnostics for unresolved aliases.

2. **Improve ownership evidence**
   - Include the full agent body in the evidence corpus.
   - Pass feature name/context into task extraction and owner selection.
   - Add a bounded feature-context bonus rather than replacing task matching.

3. **Reduce false-positive weak warnings**
   - Warn on exact score ties.
   - Keep no-confidence fallback warnings.
   - Do not suppress warnings for unassigned tasks or unknown owners.

4. **Add regression fixtures**
   - `Feature 1`;
   - `Features 1 and 2`;
   - exact feature-name dependencies;
   - one task with a clear feature owner;
   - one intentionally ambiguous task that must still produce a warning.

5. **Regenerate and inspect outputs**
   - Compile a decomposed product vision.
   - Verify phase dependencies in the manifest.
   - Verify ownership warnings are limited to real ambiguity.
   - Confirm responsibility-matrix results remain consistent.

## Design constraints to preserve

Do not solve this by:

- assigning every task to the first agent;
- suppressing all weak-match warnings;
- treating feature numbers as phase IDs directly;
- making feature ownership a hard override for every task;
- silently dropping unresolved dependencies;
- changing the manifest schema solely to hide compiler uncertainty.

The desired behavior is deterministic, explainable, and conservative: normalize
valid aliases, preserve uncertainty when evidence is insufficient, and keep
the manifest runnable when ownership is assigned.
