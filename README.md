# Switchyard

Switchyard is a local, cross-platform TypeScript toolkit for discovering coding-agent harnesses, normalizing their capabilities, and routing work to suitable harnesses. The project is designed around deterministic, explainable decisions and safe subprocess execution.

The product direction is described in [`docs/PRD.md`](docs/PRD.md). The library exports discovery, capability, harness, and command contracts from [`src/index.ts`](src/index.ts), with built-in discovery support for OpenCode and GitHub Copilot CLI.

## Current status

The current completed slice covers discovery schemas, executable lookup, bounded version/help probing, built-in discovery adapters, atomic local registry persistence, refreshable registry profiles, and the `discover` and `capabilities` commands. Execution, routing, verification, and composition remain roadmap items.

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
```

`discover` probes OpenCode and GitHub Copilot on the first run and stores a
per-user registry. Subsequent runs use the cached snapshot unless `--refresh`
is supplied. Use `--registry PATH` or `SWITCHYARD_REGISTRY_PATH` for an
explicit local file, which is useful in CI and tests. A missing or malformed
harness is reported in its profile and does not discard successful profiles.
`capabilities` only reads the registry; it never launches a harness.

JSON output is versioned with `schemaVersion: 1`. Human output is plain text
with the same statuses and profile data, and diagnostics are redacted before
either output format is emitted.

## Repository layout

| Path | Purpose |
| --- | --- |
| `src/` | TypeScript library and harness contracts |
| `tests/` | Node test-runner tests and discovery fixtures |
| `docs/PRD.md` | Product requirements and roadmap |
| `docs/` | Product, execution, and workflow documentation |
| `docs/adr/` | Architecture decision records |
| `docs/templates/` | Starting structures for maintained documents |

## Documentation conventions

Agent and contributor documentation responsibilities are defined in [`AGENTS.md`](AGENTS.md). User-facing behavior belongs in this README, release-relevant changes belong in [`CHANGELOG.md`](CHANGELOG.md), and significant architectural decisions belong in numbered ADRs under [`docs/adr/`](docs/adr/).
