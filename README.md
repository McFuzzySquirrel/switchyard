# Switchyard

Switchyard is a local, cross-platform TypeScript toolkit for discovering coding-agent harnesses, normalizing their capabilities, and routing work to suitable harnesses. The project is designed around deterministic, explainable decisions and safe subprocess execution.

The product direction is described in [`docs/PRD.md`](docs/PRD.md). The library exports discovery, capability, harness, and command contracts from [`src/index.ts`](src/index.ts), with built-in discovery support for OpenCode and GitHub Copilot CLI.

## Current status

The current completed slice covers discovery schemas, executable lookup, bounded version/help probing, built-in discovery adapters, atomic local registry persistence, refreshable registry profiles, the `discover`, `capabilities`, and `explain` commands, normalized all-required capability matching with deterministic ranking and human-readable explanations, the full vendor-neutral `HarnessAdapter` contract with explicit registration, and typed local configuration with environment/executable/registry/probe-policy precedence. Real harness execution/verification and composition remain roadmap items — built-in adapters currently support `discover` only and fail fast on other operations.

## Development

Requirements:

- Node.js 24 or newer
- npm

Install dependencies and run the existing checks:

```sh
npm install
npm test
npm run typecheck
npm run test:docs
```

## Discovery commands

The CLI is available through the package entry point:

```sh
npx switchyard discover
npx switchyard discover --refresh --json
npx switchyard capabilities
npx switchyard capabilities --verified --json
npx switchyard explain --requires=headless,repository-access
npx switchyard explain --requires=headless --json
```

`discover` probes OpenCode and GitHub Copilot on the first run and stores a
per-user registry. Subsequent runs use the cached snapshot unless `--refresh`
is supplied. Use `--registry PATH` or `SWITCHYARD_REGISTRY_PATH` for an
explicit local file, which is useful in CI and tests. A missing or malformed
harness is reported in its profile and does not discard successful profiles.
`capabilities` only reads the registry; it never launches a harness.
`explain` also only reads the registry and never launches a harness or mutates
the registry. It reports every candidate's matched and missing capabilities,
verification state, deterministic ranking inputs, and selection reason.
Requirements are all-required. Use `--preferred-harness=<id>` to request a
preferred qualifying harness; fallback remains disabled unless
`--allow-fallback` is explicitly supplied. Invalid requirements exit `2`, and
valid requirements with no qualifying selection exit `4`.

JSON output is versioned with `schemaVersion: 1`. Human output is plain text
with the same statuses and profile data, and diagnostics are redacted before
either output format is emitted.

## Requirement schema

Routing requests use the exported `TaskRequirements` contract:

```json
{
  "schemaVersion": 1,
  "requires": ["headless", "repository-access"],
  "preferredHarness": "opencode",
  "allowFallback": true
}
```

`requires` accepts only normalized capability names and cannot contain
duplicates. `preferredHarness` must be a lowercase harness identifier, and
`allowFallback` must be boolean. The runtime exports
`validateTaskRequirements`, `isTaskRequirements`, and
`assertTaskRequirements`; the schema version is optional for compatibility with
the original PRD interface. `matchRequiredCapabilities` (also exported as `matchCapabilities`) reports
matched and missing capabilities in requirement order and qualifies a profile
only when every required capability was positively observed during discovery.
`rankCapabilityMatches` and `selectBestCapabilityMatch` rank only qualifying
profiles: fully verified matches come first, followed by discovered matches,
with equal-tier ties resolved by ascending harness ID (never input order).
Stale or discovery-only lifecycle profiles are never promoted to the verified
tier. Verification state is not treated as discovery evidence.

## Adapters and configuration

`HarnessAdapter` (`src/harness/adapter.ts`) is the vendor-neutral contract for
discovery, verification, execution, resume, and fork. Built-in `opencode` and
`copilot` adapters are registered explicitly through `HarnessAdapterRegistry`
(`src/harness/adapter-registry.ts`); they currently support `discover` only,
and every other operation rejects with `UnsupportedOperationError` before any
process is launched. A reusable `createStubHarnessAdapter` fixture
(`src/harness/stub.ts`) implements the full contract for conformance and
integration testing without a real vendor binary.

Executable location, probe timeout, maximum probe output length, the
mutating-probe policy flag, and the registry path all resolve through the same
precedence: an explicit call-time value, then an environment variable, then a
typed local configuration file, then a built-in default. See
[`docs/adapter-development.md`](docs/adapter-development.md) for the full
precedence table, the adapter lifecycle, registration, testing, error
handling, and security expectations, and
[`docs/adr/0002-adapter-contract-and-typed-configuration.md`](docs/adr/0002-adapter-contract-and-typed-configuration.md)
for the design rationale. Configuration diagnostics always identify the
adapter and field path and never echo the submitted value.

## Repository layout

| Path | Purpose |
| --- | --- |
| `src/` | TypeScript library and harness contracts |
| `tests/` | Node test-runner tests and discovery fixtures |
| `docs/PRD.md` | Product requirements and roadmap |
| `docs/adapter-development.md` | Adapter lifecycle, registration, testing, errors, and security |
| `docs/` | Product, execution, and workflow documentation |
| `docs/adr/` | Architecture decision records |
| `docs/templates/` | Starting structures for maintained documents |

## Documentation conventions

Agent and contributor documentation responsibilities are defined in [`AGENTS.md`](AGENTS.md). User-facing behavior belongs in this README, release-relevant changes belong in [`CHANGELOG.md`](CHANGELOG.md), and significant architectural decisions belong in numbered ADRs under [`docs/adr/`](docs/adr/).
