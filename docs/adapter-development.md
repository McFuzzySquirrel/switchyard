# Adapter Development Guide

This guide documents how to implement, register, test, and operate a Switchyard `HarnessAdapter`. It covers the lifecycle, registration, testing, error handling, and security expectations required by `ADPT-FR-03`. See [`docs/features/adapter-extensibility-and-configuration.md`](features/adapter-extensibility-and-configuration.md) for the traceable requirements and [`docs/adr/0002-adapter-contract-and-typed-configuration.md`](adr/0002-adapter-contract-and-typed-configuration.md) for the design rationale.

## 1. The adapter contract

Every harness integration implements `HarnessAdapter` from `src/harness/adapter.ts`:

```ts
interface HarnessAdapter {
  readonly id: string;
  readonly supportedOperations: SupportedOperations; // { discover, verify, execute, resume, fork }
  discover(): Promise<HarnessProfile>;
  verify(capabilities: readonly CapabilityName[], context: ProbeContext): Promise<readonly VerificationResult[]>;
  execute(request: ExecutionRequest): Promise<ExecutionResult>;
  resume?(request: ResumeRequest): Promise<ExecutionResult>;
  fork?(request: ForkRequest): Promise<ForkResult>;
}
```

### Capability observations and operation support

Discovery returns a `HarnessProfile` whose `capabilities` entries are
`CapabilityObservation` records from `src/discovery/schema.ts`. Each record
contains a normalized vocabulary name plus independent `discovery` and
`verification` observations. Discovery evidence (for example, a bounded
`--help` excerpt) may establish that a capability was advertised, but it does
not imply that a runtime probe passed. Use
`validateCapabilityObservation`/`assertCapabilityObservation` when accepting
observations from an adapter or persistence boundary; unknown capability labels,
missing evidence, invalid timestamps, and extra fields are rejected.

The `supportedOperations` field is the closed `SupportedOperations` schema,
with exactly one boolean for each operation in
`ADAPTER_OPERATION_NAMES`: `discover`, `verify`, `execute`, `resume`, and
`fork`. Validate external or fixture declarations with
`validateOperationSupport` (or `assertOperationSupport`). Registries validate
this declaration before registration, so a misspelled operation or a
non-boolean value cannot silently affect routing. The schema describes support
only; an adapter must still call `assertOperationSupported` at the beginning
of each operation to guarantee fail-before-launch behavior.

The contract is composed from five narrow operation interfaces exported by
`src/harness/adapter.ts`: `DiscoveryAdapter`, `VerificationAdapter`,
`ExecutionAdapter`, `ResumeAdapter`, and `ForkAdapter`. Subsystems may depend
on one of these smaller interfaces; a complete registered adapter implements
all five. This keeps operation-specific consumers decoupled from vendor
details while preserving one stable boundary for registration.

`resume` and `fork` are required on the complete contract even when they are
unsupported. Implement them as fail-fast methods (Section 4), rather than
omitting them, so callers can rely on a single failure shape regardless of
which operation they invoke.

`ExecutionRequest` is the process-boundary input: it includes controlled
`cwd`, explicit `env` values plus an `environmentPolicy` allow/deny
declaration, optional controlled `stdin`, timeout and output bounds,
`AbortSignal` cancellation, non-interactive mode, and `dryRun`. The runner
must apply the environment policy before launching and must never interpolate
the task, paths, help text, or output into shell code. `ExecutionResult`
always reports a lifecycle `status`, a stable `failureCategory`, nullable
`exitCode`, bounded stdout/stderr with truncation flags, duration, and an
optional redacted diagnostic. See the type definitions in
`src/harness/adapter.ts`; process launching is implemented separately from
vendor-specific argument translation.

**Discovery-only adapters.** A harness whose discovery integration ships before its execution counterpart should implement `HarnessDiscoveryAdapter` from `src/harness/discovery-adapter.ts` (a narrower, read-only contract) and reuse `DISCOVERY_ONLY_OPERATIONS` from `src/harness/adapter.ts` for `supportedOperations`. This is how `opencode` and `copilot` ship today.

**Full adapters.** A full `HarnessAdapter` is constructed once with its resolved runtime configuration (executable location, environment, timeouts, probe policy) bound by closure. See `src/harness/opencode.ts`'s `createOpenCodeAdapter` for the pattern: `discover`, `verify`, `execute`, `resume`, and `fork` on one instance must all observe the same resolved executable. Do not accept a fresh executable/config argument per method call — that reopens the exact inconsistency the contract exists to prevent.

## 2. Lifecycle

1. **Construct.** A factory function (for example `createOpenCodeAdapter(options)`) resolves configuration once — see Section 5 — and returns a frozen object implementing `HarnessAdapter`.
2. **Register.** The adapter instance is registered explicitly (Section 3); it is never discovered or loaded dynamically.
3. **Discover.** `discover()` probes the executable and returns a schema-valid `HarnessProfile` (see `src/discovery/schema.ts`). Discovery never proves runtime capability — only that a capability was *advertised*.
4. **Verify** (when supported). `verify()` runs bounded, adapter-specific probes and returns `VerificationResult[]`, updating the profile's `verification` state independently of `discovery`.
5. **Execute / resume / fork** (when supported). These operations invoke the vendor process. Every one of them must check `supportedOperations` (directly, or through `assertOperationSupported`) *before* doing any adapter-specific work.
6. **Fail fast when unsupported.** An operation an adapter does not support must reject before any subprocess is spawned — never after a vendor command starts and then errors out. See Section 4.

## 3. Registration

Adapters are registered explicitly; **third-party adapters are not dynamically loaded in this release** (see ADR-0002 and the product vision's open questions). Two registries exist, matching the two contracts above:

- `HarnessDiscoveryAdapterRegistry` (`src/harness/discovery-adapter.ts`) — for discovery-only adapters. `createBuiltInDiscoveryAdapterRegistry()` in `src/harness/registry.ts` pre-populates it with `opencode` and `copilot`.
- `HarnessAdapterRegistry` (`src/harness/adapter-registry.ts`) — for the full contract. `createBuiltInHarnessAdapterRegistry(options)` pre-populates it with the full built-in adapters.

Both registries share the same shape: `register(adapter)` (throws on a duplicate id), `get(id)`, `list()`. Adding a new adapter never requires changing either registry class or any matching/routing logic — only calling `.register()` with the new instance. This is what the conformance suite in `tests/adapter-conformance.test.mjs` proves using `createStubHarnessAdapter`.

```ts
import { HarnessAdapterRegistry, createBuiltInHarnessAdapterRegistry } from "switchyard/harness";
import { createMyHarnessAdapter } from "./my-harness-adapter.ts";

const registry = createBuiltInHarnessAdapterRegistry();
registry.register(createMyHarnessAdapter({ executable: "/opt/my-harness/bin/my-harness" }));
```

### Registration workflow

When adding an adapter, use this order:

1. Implement the vendor-specific factory and normalize its capabilities to the shared vocabulary.
2. Register the constructed adapter with the existing registry. Use
   `HarnessDiscoveryAdapterRegistry` for a discovery-only adapter and
   `HarnessAdapterRegistry` for a complete adapter.
3. Add the adapter to the built-in factory only when it is maintained and
   shipped as part of Switchyard. Do not add vendor-specific branches to
   routing, matching, or registry classes.
4. Add conformance cases for the registration, support matrix, configuration
   precedence, executable override consistency, and fail-before-launch
   behavior described in Section 6.

The registration boundary is intentionally explicit: this release does not
load third-party adapters from configuration or package names. A registration
test should therefore construct the adapter, call `register`, and assert its
id is returned by `list()` (and that a duplicate id is rejected).

## 4. Errors and fail-fast unsupported operations

`src/harness/adapter.ts` exports the shared, vendor-neutral failure primitives every adapter must use:

- `UnsupportedOperationError` — thrown/rejected with `adapterId` and `operation` fields. Its message never includes request or response payloads.
- `throwUnsupportedOperation(adapterId, operation): never` — for an operation an adapter permanently does not support (its return type of `never` lets a method's implementation be a single line without a dead-code return statement).
- `assertOperationSupported(adapter, operation): void` — for an operation whose support varies per adapter instance (for example, a stub that supports `resume` but not `fork`); throws `UnsupportedOperationError` when unsupported, otherwise returns so the method's real implementation can proceed.

Both mechanisms guarantee the same thing: **the rejection happens before any process is spawned.** Do not implement a partial vendor invocation and then translate a vendor error into `UnsupportedOperationError` — check support first.

Other adapter-local errors (a failed probe, a malformed help response, an executable that cannot be found) should use the existing discovery diagnostics (`HarnessDiagnostic`, `HarnessAvailabilityProfile` in `src/discovery/schema.ts`) and `redactSecrets`/`boundExcerpt` from `src/discovery/probe.ts` before any text reaches a diagnostic, log, or CLI output.

## 5. Configuration

Adapters do not read environment variables or configuration files themselves. A caller resolves configuration once via `resolveHarnessRuntimeConfig` (`src/config/resolve.ts`) and passes the result to the adapter factory. The built-in `discover` command performs this wiring automatically for each registered adapter:

```ts
import { resolveHarnessRuntimeConfig, loadSwitchyardConfig } from "switchyard/config";
import { createOpenCodeAdapter } from "switchyard/harness";

const config = await loadSwitchyardConfig(); // reads the local config file, or {} if absent
const resolved = resolveHarnessRuntimeConfig("opencode", config, { executable: cliFlagValue });
const adapter = createOpenCodeAdapter(resolved);
```

`resolveHarnessRuntimeConfig` emits a single normalized `executable` plus
`executableSource` (`override` for explicit/env values, `configured` for the
local file). Pass that resolved object to the adapter factory; do not pass a
different executable to individual methods. The compatibility
`configuredExecutable` field remains available for discovery-only consumers
when the configuration-file value wins precedence, but new full-adapter code
should treat `executable` as the one shared override for discovery,
verification, execution, resume, and fork.

For embedded callers, `discover({ configPath, env, adapters })` loads the same
typed file and applies the resolved per-harness options before probing.
`capabilities({ configPath })` and `explain({ configPath })` also use the
configuration file's `registryPath` when no explicit `registryPath` or
`SWITCHYARD_REGISTRY_PATH` is supplied. This keeps executable, probe-policy,
and registry-location overrides consistent without requiring each adapter or
command to parse configuration independently.

Every configurable field — executable location, probe timeout, maximum output length, and the mutating-probe policy flag — resolves with the **same precedence**: an explicit call-time value (for example, a CLI flag), then an environment variable, then the local configuration file, then a built-in default. Nothing skips a tier.

| Field | Explicit | Environment variable | Config file | Default |
|---|---|---|---|---|
| Executable | factory option / CLI flag | `SWITCHYARD_<HARNESS>_EXECUTABLE` | `harnesses.<id>.executable` | PATH lookup |
| Probe timeout | factory option | `SWITCHYARD_<HARNESS>_PROBE_TIMEOUT_MS`, then `SWITCHYARD_PROBE_TIMEOUT_MS` | `harnesses.<id>.probePolicy.timeoutMs`, then `probePolicy.timeoutMs` | 5000 |
| Max output length | factory option | `SWITCHYARD_<HARNESS>_PROBE_MAX_OUTPUT_LENGTH`, then `SWITCHYARD_PROBE_MAX_OUTPUT_LENGTH` | `harnesses.<id>.probePolicy.maxOutputLength`, then `probePolicy.maxOutputLength` | 8192 |
| Allow mutating probes | factory option | `SWITCHYARD_<HARNESS>_ALLOW_MUTATING_PROBES`, then `SWITCHYARD_ALLOW_MUTATING_PROBES` | `harnesses.<id>.probePolicy.allowMutatingProbes`, then `probePolicy.allowMutatingProbes` | `false` |
| Registry path | `resolveEffectiveRegistryPath` argument | `SWITCHYARD_REGISTRY_PATH` | `registryPath` | platform-appropriate user config directory |

`<HARNESS>` is the harness id upper-cased with non-alphanumeric characters replaced by `_` (for example, `opencode` → `OPENCODE`).

The local configuration file lives at the platform-appropriate path returned
by `defaultConfigPath()` (override with `--config`,
`SWITCHYARD_CONFIG_PATH`, or an explicit path passed to
`resolveConfigPath`/`loadSwitchyardConfig`). It is a JSON document validated
against the typed schema in `src/config/schema.ts`:

```json
{
  "schemaVersion": 1,
  "registryPath": "/custom/path/registry.json",
  "probePolicy": { "timeoutMs": 5000, "maxOutputLength": 8192, "allowMutatingProbes": false },
  "harnesses": {
    "opencode": { "executable": "/opt/opencode/bin/opencode" },
    "copilot": { "probePolicy": { "timeoutMs": 8000 } }
  }
}
```

An invalid field is rejected with a `ConfigValidationError`/`ConfigPersistenceError` whose `issues` array names the offending path (for example, `$.harnesses.opencode.executable`) and the expected shape. **The submitted value is never included in the message or the issue**, so a field that accidentally contains a token or path with sensitive contents is never echoed back in an error, log, or CLI diagnostic.

## 6. Testing an adapter

Use `tests/adapter-conformance.test.mjs` as the template. At minimum, a new adapter's tests should prove:

1. **Registration.** The adapter registers into `HarnessAdapterRegistry` (or `HarnessDiscoveryAdapterRegistry` for a discovery-only adapter) with no changes to the registry class or any other adapter.
2. **Accurate `supportedOperations`.** The declared support matrix matches what the adapter actually does.
3. **Fail-before-launch.** Every unsupported operation rejects with `UnsupportedOperationError` naming the correct `adapterId`/`operation`, and does so without spawning a process — assert this concretely (for example, using a fixture script that writes a sentinel file only when actually invoked, then asserting the sentinel is absent).
4. **Executable-override consistency.** The same override reaches every operation on one instance (discovery, verification, execution) — not just the operation under test.
5. **Configuration precedence and diagnostics.** `resolveHarnessRuntimeConfig` and `validateSwitchyardConfig` behave per Section 5 for this harness's id, and invalid input produces actionable, secret-free diagnostics.

For adapters that do not have (or should not require) a real vendor binary in CI, use `createStubHarnessAdapter` from `src/harness/stub.ts` as a reusable fixture; it implements the full contract, records every operation actually invoked (`.calls`), and defaults `fork` to unsupported so both the success and fail-fast paths are exercised from one instance.

Run the focused suite while developing an adapter:

```sh
node --experimental-strip-types --test tests/adapter-conformance.test.mjs
```

The fixture and suite use the same production registry boundary as built-in
adapters. Keep the test independent of a vendor installation; use a temporary
executable fixture or the stub's recorded `.calls` instead of invoking a real
binary. Before submitting, run the repository checks documented in the
README, including `npm run test:docs`.

## 7. Security expectations

- **No shell interpolation.** Adapters spawn the resolved executable directly with an argument array; they never build a shell command string from vendor output or configuration values (see `src/discovery/probe.ts`'s `probeExecutable`).
- **Redact before you diagnose.** Any text derived from vendor output, paths, or configuration that reaches a diagnostic, log, or CLI surface must pass through `redactSecrets`/`boundExcerpt` first.
- **No secrets in configuration diagnostics.** Configuration validation errors identify a field path and an expected shape only; they must never include the submitted value (Section 5).
- **Explicit registration only.** This release does not dynamically load adapters from configuration or third-party packages; every adapter is registered by code the maintainer controls and can audit.
- **Bounded probes by default.** Probing (`discover`/`verify`) must remain read-only, bounded, and non-mutating unless a probe policy explicitly opts in via `allowMutatingProbes` (`SP-07` in the product vision).
- **No credential storage.** Adapters and configuration must never persist or print harness credentials; authentication failures are adapter execution/configuration failures with a redacted, actionable message (see the product vision's open question 11).
