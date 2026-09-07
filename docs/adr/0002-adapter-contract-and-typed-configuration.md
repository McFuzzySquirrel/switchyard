# ADR-0002: Adapter contract, explicit registration, and typed configuration precedence

- **Status:** Accepted
- **Date:** 2026-09-07

## Context

Switchyard's product vision requires that future harnesses can be added without changing core routing (`ADPT-FR-01`), that built-in adapters accurately declare what they support, and that harnesses, executable locations, and probe policy be configurable in a way that fails with actionable diagnostics rather than silently misbehaving (`ADPT-FR-02`). Before this decision, `HarnessAdapter` (discovery, verification, execution, resume, fork) was defined as a TypeScript interface, but no concrete adapter implemented the full contract, no explicit registry existed for it, and there was no typed local configuration file, environment-variable precedence, or probe-policy schema — only registry-path resolution existed.

Two risks motivated a deliberate design rather than an incremental one:

1. An executable override that reaches `discover()` but not `verify()`/`execute()` on the same logical harness would let a routing decision and an execution attempt silently disagree about which binary is in use.
2. Ad hoc unsupported-operation handling (each adapter deciding independently how to fail) would let a caller reach a partially-implemented vendor invocation instead of failing before any process launch.

## Decision

- Every adapter (built-in or a conformance stub) is constructed once with its fully resolved runtime configuration bound by closure, so `discover`, `verify`, `execute`, `resume`, and `fork` on one instance always observe the same executable, environment, and probe policy. Configuration is never re-resolved per operation.
- `supportedOperations` remains the single declarative source of truth for what an adapter can do. A shared `assertOperationSupported`/`throwUnsupportedOperation` pair in `src/harness/adapter.ts` is the only mechanism adapters use to reject an unsupported operation, and it rejects before any subprocess is spawned. Built-in adapters and the stub fixture both use it; no adapter defines its own unsupported-operation branching.
- `HarnessAdapterRegistry` (`src/harness/adapter-registry.ts`) provides explicit, in-memory registration for the full contract, mirroring the existing `HarnessDiscoveryAdapterRegistry`. Adapters are not loaded dynamically from configuration or third-party packages in this release; every adapter instance is registered by code that assembles the runtime.
- A typed local configuration schema (`src/config/schema.ts`) defines `registryPath`, a default `probePolicy`, and per-harness `executable`/`probePolicy` overrides. Validation reports only a field path and an expected-shape message — never the submitted value — so a misconfigured field can never leak a secret-looking string into a diagnostic.
- Every configurable field (executable, timeout, output bound, mutating-probe policy, registry path) resolves through the same fixed precedence: an explicit call-time value, then an environment variable, then the local configuration file, then a built-in default. `src/config/resolve.ts` implements this once so no field's precedence surprises callers relative to another field's.
- A stub adapter (`src/harness/stub.ts`) implements the full contract without a vendor process and is exported as a first-class conformance fixture, not a test-only script, so other engineers' conformance and integration suites can register it through the same registry used by built-ins.

## Consequences

- Adding a future harness only means writing a new adapter module and registering it explicitly; no other module (including the eventual matcher/router) needs adapter-specific conditionals.
- Executable-override consistency is a structural property of adapter construction, not a convention adapters must remember to follow.
- Unsupported-operation handling is uniform and centrally testable; conformance suites can assert `UnsupportedOperationError` shape once and rely on it for every adapter.
- Configuration diagnostics are safe to display or log directly, at the cost of being less specific about which value was rejected (only where it was rejected).
- Built-in OpenCode and GitHub Copilot adapters currently expose only `discover`; `verify`/`execute`/`resume`/`fork` intentionally fail fast until the verification and execution runtime features (owned separately) provide real implementations. This is expected, not a regression, and is covered by conformance tests.

## Alternatives considered

- **Per-call configuration passed to each adapter method:** Rejected because it reopens the exact inconsistency risk this decision addresses — nothing prevents a caller from passing a different executable to `discover()` than to `execute()`.
- **Adapter-specific unsupported-operation errors:** Rejected because it would require the (future) matcher/router to understand multiple error shapes, defeating the goal of adapter changes never requiring matcher changes.
- **Dynamic adapter loading from configuration paths:** Rejected for this release per the product vision's open question; the trust boundary for loading arbitrary code is not yet defined. Explicit registration keeps the adapter set auditable.
- **A single global environment variable per field (no per-harness override):** Rejected because different harnesses can legitimately need different timeouts or executables; a per-harness variable with a global fallback keeps both cases simple.
