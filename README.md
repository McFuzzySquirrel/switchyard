# Switchyard

Switchyard is a local, cross-platform TypeScript toolkit for discovering coding-agent harnesses, normalizing their capabilities, and routing work to suitable harnesses. The project is designed around deterministic, explainable decisions and safe subprocess execution.

The product direction and planned CLI are described in [`docs/PRD.md`](docs/PRD.md). The currently implemented code exports discovery, capability, and harness contracts from [`src/index.ts`](src/index.ts), with built-in discovery support for OpenCode and GitHub Copilot CLI.

## Current status

The repository is under active implementation. The current completed slice covers discovery schemas, executable lookup, bounded version/help probing, built-in discovery adapters, atomic local registry persistence, and refreshable registry profiles with configurable stale-entry marking. Planned commands and later execution/composition features should be treated as roadmap items until implemented and tested.

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
