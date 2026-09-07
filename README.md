# Switchyard

Switchyard is a local, cross-platform TypeScript toolkit for discovering coding-agent harnesses, normalizing their capabilities, and routing work to suitable harnesses. The project is designed around deterministic, explainable decisions and safe subprocess execution.

The product direction is described in [`docs/PRD.md`](docs/PRD.md). The library exports discovery, capability, harness, and command contracts from [`src/index.ts`](src/index.ts), with built-in discovery support for OpenCode and GitHub Copilot CLI.

## Current status

The current completed slice covers discovery schemas, executable lookup, bounded version/help probing, built-in discovery adapters, atomic local registry persistence, refreshable registry profiles, the `discover`, `capabilities`, `explain`, and `run` commands, normalized all-required capability matching with deterministic ranking and human-readable explanations, the full vendor-neutral `HarnessAdapter` contract with explicit registration, typed local configuration with environment/executable/registry/probe-policy precedence, and the bounded process execution runtime connected to routed selection. Built-in adapters currently support `discover` only and fail fast on other operations, so `run` against them deterministically reports `unavailable` until a real `execute` implementation is registered.

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
npx switchyard capabilities --config ./switchyard.config.json
npx switchyard run --requires=headless "fix the failing test"
npx switchyard run --requires=headless --dry-run --json "fix the failing test"
```

`discover` probes OpenCode and GitHub Copilot on the first run and stores a
per-user registry. Subsequent runs use the cached snapshot unless `--refresh`
is supplied. Use `--registry PATH`, `SWITCHYARD_REGISTRY_PATH`, or
`registryPath` in the typed configuration file for an explicit local file,
which is useful in CI and tests. `--config PATH` (or
`SWITCHYARD_CONFIG_PATH`) selects a non-default configuration file for every
registry-reading command. A missing or malformed harness is reported in its
profile and does not discard successful profiles. `capabilities` only reads
the registry; it never launches a harness. `explain` also only reads the
registry and never launches a harness or mutates the registry. It reports
every candidate's matched and missing capabilities,
verification state, deterministic ranking inputs, and selection reason.
Requirements are all-required. Use `--preferred-harness=<id>` to request a
preferred qualifying harness; fallback remains disabled unless
`--allow-fallback` is explicitly supplied. Invalid requirements exit `2`
(`CLI_EXIT_CODES.invalidInput`), and valid requirements with no qualifying
selection exit `4` (`CLI_EXIT_CODES.noMatch`).

`run --requires=<capabilities> [--json] [--dry-run] [--cwd PATH]
[--timeout-ms MS] "<task>"` connects that same routing decision to adapter
execution: it calls `explain` internally for selection, then executes the
selected harness's `execute` operation with a controlled working directory,
environment, timeout, and cancellation boundary (`src/harness/process.ts`).
It never launches a harness for `no-match` or `invalid-input` decisions, and
`--dry-run` describes the selected request without resolving or invoking an
adapter, making previews safe even when the harness is not installed. A
normal run whose harness is not registered, or whose adapter has not declared `execute`
support, is reported as `status: "unavailable"` and exits `5`
(`CLI_EXIT_CODES.unavailable`) before any process starts. A completed
execution that failed, timed out, or was cancelled is reported as
`status: "execution-failure"` and exits `3` (`CLI_EXIT_CODES.failure`); the
JSON result's nested `execution` field retains the finer-grained
`ExecutionResult` status and failure category. `no-match` and
`invalid-input` reuse the same `4` and `2` exit categories as `explain`.

JSON output is versioned with `schemaVersion: 1`. All command JSON payloads use
the shared `serializeCommandJson` contract exported from `src/output/index.ts`;
the serializer preserves command-owned fields while enforcing the common
`schemaVersion`, `command`, and `status` envelope. The explain payload is the
versioned routing-decision contract (`DECISION_SCHEMA_VERSION`) and keeps
success, no-match, and invalid-input as distinct status variants. Consumers
can use `parseDecisionJson` to validate that discriminator before applying
command-specific validation. Human output
is plain text with the same statuses and decision data, and diagnostics are
redacted before either output format is emitted. New fields are additive; a
schema-version bump is reserved for incompatible changes.

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
tier. Verification state is not treated as discovery evidence. When
`preferredHarness` is set, the preferred profile is checked first and is
selected only if it satisfies every requirement. A different qualifying
profile is selected only when `allowFallback: true`; fallback is disabled by
default. Explain and run results include deterministic `policy.attempts`
records for the preferred check and selected fallback/ranked candidate.

## Adapters and configuration

`HarnessAdapter` (`src/harness/adapter.ts`) is the vendor-neutral contract for
discovery, verification, execution, resume, and fork. Built-in `opencode` and
`copilot` adapters are registered explicitly through `HarnessAdapterRegistry`
(`src/harness/adapter-registry.ts`); they currently support `discover` only,
and every other operation rejects with `UnsupportedOperationError` before any
process is launched. A reusable `createStubHarnessAdapter` fixture
(`src/harness/stub.ts`) implements the full contract for conformance and
integration testing without a real vendor binary. The exported
`ExecutionRequest` and `ExecutionResult` types define controlled working
directory/environment policy, safe stdin and cancellation inputs, bounded
output metadata, lifecycle status, and stable failure categories for the
execution runtime.
`executeProcess` and `runProcess` provide the shared direct-argv runtime for
adapter implementations. They never invoke a shell, apply environment
inheritance allow/deny rules, cap each output stream independently, redact
diagnostics, and distinguish ordinary failures from timeout and cancellation.
Verification adapters return the versioned `VerificationResult` schema,
validated with `validateVerificationResult` (or
`assertVerificationResult`), including ordered UTC `startedAt` and
`completedAt` timestamps. Verification probes default to a five-second
timeout; set `ProbeContext.timeoutMs` for a different positive bound. The
runner passes `ProbeContext.signal` for cooperative cancellation and returns
explicit `timed-out` results if an adapter does not finish within its bound.

Executable location, probe timeout, maximum probe output length, the
mutating-probe policy flag, and the registry path all resolve through the same
precedence: an explicit call-time value, then an environment variable, then a
typed local configuration file, then a built-in default. Executable values are
normalized once into a single resolved override before adapter construction,
so discovery, future verification, and future execution share the same
executable and source classification. See
[`docs/adapter-development.md`](docs/adapter-development.md) for the full
precedence table, the adapter lifecycle, registration, testing, error
handling, and security expectations, and
[`docs/adr/0002-adapter-contract-and-typed-configuration.md`](docs/adr/0002-adapter-contract-and-typed-configuration.md)
for the design rationale. Configuration diagnostics always identify the
adapter and field path and never echo the submitted value.

To validate a new adapter without installing its vendor binary, register it
through the existing registry and run the reusable conformance suite:

```sh
node --experimental-strip-types --test tests/adapter-conformance.test.mjs
```

The suite covers registration, normalized operation support, configuration
precedence, executable-override consistency, and unsupported-operation
fail-fast behavior. See the [adapter development guide](docs/adapter-development.md)
for the registration workflow and fixture pattern.

The `discover`, `capabilities`, and `explain` commands load the per-user JSON
configuration automatically. Use `--config PATH`, `SWITCHYARD_CONFIG_PATH`, or
the corresponding `{ configPath }` library option to select another file.
Per-harness environment variables such as `SWITCHYARD_OPENCODE_EXECUTABLE`
and `SWITCHYARD_OPENCODE_PROBE_TIMEOUT_MS` override matching file entries
without changing adapter code.

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
