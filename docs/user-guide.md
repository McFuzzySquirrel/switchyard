# Switchyard User Guide

Switchyard discovers coding-agent harnesses, compares their capabilities, and routes work through deterministic selection rules. This guide covers the command-line workflow first, then the configuration, verification, workflow, and adapter-development paths.

For the short project overview, see the [README](../README.md). For the detailed adapter contract, see the [Adapter Development Guide](adapter-development.md).

## 1. Before You Start

Switchyard requires:

- Node.js 24 or newer
- npm
- At least one supported harness executable when you want to refresh discovery

Install the project dependencies from the repository root:

```sh
npm install
```

During development, invoke the CLI with:

```sh
npx switchyard --help
```

The published package exposes the same `switchyard` executable through its package `bin` entry.

## 2. The Basic Workflow

A normal session has four steps:

1. Discover the harnesses installed on this machine.
2. Inspect the normalized capabilities in the local registry.
3. Preview the routing decision for a capability requirement.
4. Run a task, or use a dry run while configuring the environment.

### Discover installed harnesses

```sh
npx switchyard discover
```

The first discovery creates a per-user registry snapshot. Later discovery calls reuse that snapshot unless it is stale or you request a refresh:

```sh
npx switchyard discover --refresh
```

Use JSON output in scripts and CI:

```sh
npx switchyard discover --refresh --json
```

A missing executable or malformed harness does not discard successful profiles. The result records the affected harness diagnostic so the rest of the registry remains useful.

### Inspect capabilities

```sh
npx switchyard capabilities
npx switchyard capabilities --verified
npx switchyard capabilities --json
```

`capabilities` reads the registry only. It never launches a harness. `--verified` filters the display to capabilities with successful verification evidence.

### Explain a routing decision

```sh
npx switchyard explain --requires=headless,repository-access
npx switchyard explain --requires=headless --json
```

Requirements are all-required: a candidate must positively match every requested capability. The explanation includes matched and missing capabilities, discovery and verification state, ranking inputs, and the reason for selection.

A preferred harness is selected only when it qualifies. Fallback is opt-in:

```sh
npx switchyard explain \
  --requires=headless \
  --preferred-harness=opencode \
  --allow-fallback
```

Without `--allow-fallback`, a preferred harness that misses a requirement produces no selection even when another harness qualifies.

### Run a task

```sh
npx switchyard run --requires=headless "fix the failing test"
```

`run` uses the same routing policy as `explain`, then invokes the selected adapter's `execute` operation. It accepts a controlled working directory and a positive timeout:

```sh
npx switchyard run \
  --requires=headless \
  --cwd ./my-repository \
  --timeout-ms 120000 \
  "run the test suite and fix the first failure"
```

Preview the decision without resolving or invoking an adapter:

```sh
npx switchyard run \
  --requires=headless \
  --dry-run \
  --json \
  "fix the failing test"
```

A dry run is safe to use before the selected harness is installed. It reports the planned request but does not start a process.

> [!NOTE]
> The built-in OpenCode and Copilot adapters currently support discovery only. A normal `run` against those built-ins reports `unavailable` until an execution-capable adapter is registered. Use `--dry-run` to inspect routing, or use a registered execution-capable adapter for actual execution.

## 3. Commands At A Glance

| Command | Purpose | Launches a harness? | Changes local state? |
| --- | --- | ---: | ---: |
| `discover` | Probe configured harnesses and update the registry | Yes, for bounded discovery probes | Yes |
| `capabilities` | Read normalized capability profiles | No | No |
| `explain` | Explain deterministic selection | No | No |
| `run` | Route and execute one task | Yes, unless `--dry-run` | No registry change |
| `verify` | Run selected capability probes | Yes, when supported | Yes |
| `compose` | Execute a declared multi-stage workflow | Yes, when selected stages support execution | Yes, workflow state |

The complete built-in option list is available with `npx switchyard --help`.

## 4. Capabilities And Selection

Capabilities are normalized names, such as `headless` and `repository-access`, rather than vendor-specific command phrases. A requirement may be supplied as a comma-separated list:

```sh
npx switchyard explain --requires=headless,repository-access
```

A candidate qualifies only when every requirement is positively observed. Matching preserves requirement order so diagnostics are stable and easy to compare.

### Discovery versus verification

Discovery answers: “Does this harness advertise or expose this capability?” Its evidence may come from bounded version or help probing. Verification answers: “Did a bounded runtime probe confirm this capability?” These are independent observations:

- `discovery: observed` does not imply `verification: passed`.
- A fully verified qualifying match ranks ahead of a discovery-only qualifying match.
- Stale or discovery-only lifecycle profiles are not promoted to the verified tier.
- Verification state is persisted separately from discovery evidence.

Harness IDs break equal-tier ties in ascending order. Selection does not depend on the order in which profiles happen to be read.

## 5. Verification And Probe Policy

Run a bounded probe for one harness and one or more capabilities:

```sh
npx switchyard verify \
  --harness=opencode \
  --capability=headless
```

Repeat `--capability` to verify several capabilities:

```sh
npx switchyard verify \
  --harness=opencode \
  --capability=headless \
  --capability=repository-access \
  --json
```

Read-only probes are allowed by default. Declare the risks associated with a probe, and approve the matching policy explicitly when needed:

```sh
npx switchyard verify \
  --harness=opencode \
  --capability=external-access \
  --risk=external-access \
  --allow-external-access
```

Available risk classes and approvals are:

| Risk | Approval flag |
| --- | --- |
| `read-only` | Allowed by default |
| `mutating` | `--allow-mutating-probes` |
| `external-access` | `--allow-external-access` |
| `paid` | `--allow-paid-probes` |
| `model-invoking` | `--allow-model-invocation` |

Probes are bounded by a timeout and output limit. JSON and human output include fixed, payload-free warnings for risky probes. Diagnostics redact secrets and do not expose command arguments, prompts, environment values, or captured secrets.

## 6. Configuration

Switchyard accepts a typed local JSON configuration file. Select a file explicitly with:

```sh
npx switchyard discover --config ./switchyard.config.json
```

The same `--config` option applies to registry-reading commands. `SWITCHYARD_CONFIG_PATH` can select the file when a command-line option is inconvenient.

A minimal configuration can pin executable locations and the registry path:

```json
{
  "schemaVersion": 1,
  "registryPath": "/work/switchyard/registry.json",
  "harnesses": {
    "opencode": {
      "executable": "/opt/opencode/bin/opencode"
    },
    "copilot": {
      "probePolicy": {
        "timeoutMs": 8000
      }
    }
  }
}
```

Supported configuration fields are:

| Field | Meaning |
| --- | --- |
| `schemaVersion` | Optional schema version; currently `1` |
| `registryPath` | Local registry file location |
| `probePolicy.timeoutMs` | Positive probe timeout in milliseconds |
| `probePolicy.maxOutputLength` | Positive captured probe-output limit |
| `probePolicy.allowMutatingProbes` | Whether mutating probes are allowed by policy |
| `probePolicy.allowExternalAccess` | Whether external-service probes are allowed |
| `probePolicy.allowPaidProbes` | Whether probes that may incur charges are allowed |
| `probePolicy.allowModelInvocation` | Whether probes that invoke a model are allowed |
| `harnesses.<id>.executable` | Per-harness executable override |
| `harnesses.<id>.probePolicy` | Per-harness policy override |

The same policy fields may be placed under a harness entry or the top-level `probePolicy`. Per-harness values take precedence over top-level policy values.

### Configuration precedence

For executable, timeout, output limit, and probe-policy fields, Switchyard resolves values in this order:

1. Explicit call-time or command-line override
2. Environment variable
3. Local configuration file
4. Built-in default

Useful environment variables include:

| Setting | Environment variable |
| --- | --- |
| Configuration file | `SWITCHYARD_CONFIG_PATH` |
| Registry path | `SWITCHYARD_REGISTRY_PATH` |
| OpenCode executable | `SWITCHYARD_OPENCODE_EXECUTABLE` |
| Copilot executable | `SWITCHYARD_COPILOT_EXECUTABLE` |
| Global probe timeout | `SWITCHYARD_PROBE_TIMEOUT_MS` |
| Harness probe timeout | `SWITCHYARD_<HARNESS>_PROBE_TIMEOUT_MS` |
| Global output limit | `SWITCHYARD_PROBE_MAX_OUTPUT_LENGTH` |
| Harness output limit | `SWITCHYARD_<HARNESS>_PROBE_MAX_OUTPUT_LENGTH` |
| Global mutating-probe policy | `SWITCHYARD_ALLOW_MUTATING_PROBES` |
| Harness mutating-probe policy | `SWITCHYARD_<HARNESS>_ALLOW_MUTATING_PROBES` |

The same naming pattern applies to external-access, paid-probe, and model-invocation policy settings. Replace non-alphanumeric characters in a harness ID with `_` and uppercase the result. For example, `my-harness` becomes `MY_HARNESS`.

Boolean environment values accept `1`, `0`, `true`, and `false`.

Use `--registry PATH` or `SWITCHYARD_REGISTRY_PATH` when a temporary or CI-specific registry is preferable to the platform default. Configuration validation reports the field path and expected shape without echoing the submitted value.

## 7. Registry Freshness And CI

The registry is a cached local snapshot. Refresh it when installing or changing a harness:

```sh
npx switchyard discover --refresh --registry ./ci-registry.json --json
```

Use `--stale-after-ms` when an automation job should treat older profiles as stale:

```sh
npx switchyard discover --stale-after-ms 3600000 --json
```

For scripts, prefer `--json`, provide an explicit registry path, and inspect the command status and exit code. Do not parse human-readable diagnostics as a stable API.

## 8. Workflow Composition

`compose` executes a JSON workflow with a workspace and one or more stages:

```sh
npx switchyard compose ./examples/opencode-to-copilot.workflow.json --json
```

Each workflow declares:

- A stable workflow `id`.
- A `workspace` root.
- Stages with an `id`, task, and capability requirements.
- Optional `dependsOn` stage IDs.
- Optional output artifacts with a name, kind, and workspace-relative path.
- Optional inputs that explicitly request an artifact or approved context from a dependency.

A stage input must name its source stage, and that source must also be a declared dependency. Allowed context fields are `status`, `selectedHarness`, `durationMs`, and `diagnostic`. The receiving stage receives only the declared handoff manifest; stdout, stderr, environment variables, and opaque conversation state are not transferred.

File and directory artifacts must remain inside the workflow workspace and must match their declared kind when the receiving stage consumes them. Metadata artifacts do not carry a path. Validation rejects duplicate names, unknown stages, cycles, undeclared artifacts, invalid capability requirements, and paths outside the workspace before execution begins.

Stages execute in deterministic dependency order. When a stage fails or is skipped, earlier successful results remain available and the overall result is `partial` with a stage summary. Inspect the per-stage diagnostics and persisted `switchyard-workflow-state.json` snapshot before retrying a failed workflow.

The repository's [OpenCode-to-Copilot example](../examples/opencode-to-copilot.workflow.json) demonstrates an implementation stage publishing a patch and a review stage consuming that declared file plus status context. The demonstration test uses execution-capable fixture adapters because the built-in vendor adapters are currently discovery-only.

## 9. Output, JSON, And Exit Codes

Human output is intended for interactive use. JSON output is versioned with `schemaVersion: 1` and includes the common `command` and `status` envelope. New fields are additive; consumers should branch on status and tolerate additional fields.

The stable command exit categories are:

| Code | Category | Meaning |
| ---: | --- | --- |
| `0` | `success` | The command completed successfully, including a dry run |
| `1` | `partial` | Some workflow stages or refresh operations failed |
| `2` | `invalidInput` | Arguments or command input failed validation |
| `3` | `failure` | A command or selected execution failed |
| `4` | `noMatch` | No harness satisfied all requested capabilities |
| `5` | `unavailable` | The selected harness cannot execute the request |

For `run`, timeout and cancellation remain detailed nested execution failure categories while the command-level result uses exit code `3`. A valid request with no qualifying candidate uses `4`; it does not launch a harness. A selected candidate without execution support uses `5`; it also fails before a process starts.

Keep task text, diagnostics, and captured output out of logs unless the output has been reviewed for secrets. Switchyard's serializers redact sensitive values before human or JSON output, but downstream systems should still treat task data as potentially sensitive.

## 10. Troubleshooting

### No harness appears after discovery

Run a refresh and inspect JSON diagnostics:

```sh
npx switchyard discover --refresh --json
```

Confirm the executable is on `PATH`, or set an explicit `--executable` value or a per-harness configuration entry. A configured executable path is normalized relative to the current working directory when it is not absolute.

### Capabilities are missing

Check the exact normalized capability name and remember that requirements are all-required:

```sh
npx switchyard capabilities --json
npx switchyard explain --requires=headless --json
```

A capability observed during discovery may still need verification before it ranks as fully verified. Refresh the registry after changing the harness installation.

### `run` returns `no-match`

At least one requested capability was not positively observed by any candidate. Use `explain --json` to see each candidate's matched and missing capabilities. Remove an incorrect requirement or install/configure a harness that provides it.

### `run` returns `unavailable`

A candidate qualified, but its adapter is not registered for execution. This is expected for the current built-in discovery-only OpenCode and Copilot adapters. Use `--dry-run` for selection previews or register an execution-capable adapter.

### A preferred harness is not selected

A preferred harness must satisfy every requirement. Add `--allow-fallback` only when another qualifying harness may be used; the default is to fail rather than silently route elsewhere.

### Verification is denied

Read the risk warning and add only the approval flag that matches the declared risk. External, paid, model-invoking, and mutating probes are intentionally opt-in. A timeout or failed probe records verification failure; it does not erase discovery evidence.

### Configuration is rejected

Use the field path in the validation diagnostic to locate the problem. Check that timeouts and output limits are positive integers, policy values are booleans, executable values are non-empty strings, and harness IDs use lowercase letters, numbers, `.`, `_`, or `-`.

### A workflow is partial or rejected

A rejected workflow failed validation before execution. Check stage IDs, dependencies, capability names, artifact declarations, and workspace-relative paths. A partial workflow started successfully but one or more stages failed or were skipped; use the durable state file and stage diagnostics to resume the investigation.

## 11. Adapter Developers

Use this section when adding a harness integration to an application or to Switchyard itself.

### Choose the contract

Use `HarnessDiscoveryAdapter` when an integration only discovers a vendor installation. Use the complete `HarnessAdapter` contract when it supports discovery, verification, execution, resume, and fork as applicable. The built-in OpenCode and Copilot integrations currently use the discovery-only path.

Adapters are registered explicitly in a `HarnessAdapterRegistry` or `HarnessDiscoveryAdapterRegistry`. Switchyard does not dynamically load third-party adapters from configuration in this release.

### Preserve the operation boundary

Declare the exact `supportedOperations` matrix and reject unsupported operations before doing adapter-specific work or spawning a process. The shared `UnsupportedOperationError` identifies the adapter and operation without including request or response payloads.

Resolve executable and policy configuration once, construct the adapter with that resolved runtime configuration, and use the same executable for discovery, verification, and execution. Do not re-read environment variables inside individual operations.

### Test and secure the integration

At minimum, test registration, the support matrix, fail-before-launch behavior, executable override consistency, configuration precedence, bounded output, cancellation, and secret-free diagnostics. The reusable stub adapter and [adapter conformance suite](../tests/adapter-conformance.test.mjs) provide the repository pattern.

Adapters must invoke executables with direct argument arrays rather than shell interpolation, apply the environment allow/deny policy, bound output, clean up timed-out processes, and redact vendor-derived diagnostics. The full lifecycle, schema, and security requirements are documented in the [Adapter Development Guide](adapter-development.md).

## 12. Library Consumers

The CLI is one entry point to the exported TypeScript contracts. Public modules are available from the package root and subpath exports for capabilities, commands, composition, configuration, discovery, harnesses, output, and verification.

Use the typed validators at persistence and integration boundaries. For example, workflow authors can call `validateWorkflow` for structured issues or `assertWorkflow` when invalid input should throw. Consumers of JSON command results should use the exported parsers and inspect the discriminator before applying command-specific fields.

Keep library calls subject to the same rules as the CLI: all requirements are required, unsupported operations fail before launch, path-bearing workflow artifacts remain workspace-contained, and diagnostics must not expose secrets.

## 13. Further Reference

- [Project README](../README.md) for the overview and development checks.
- [Adapter Development Guide](adapter-development.md) for the complete adapter lifecycle and conformance procedure.
- [OpenCode-to-Copilot workflow](../examples/opencode-to-copilot.workflow.json) for a complete composition definition.
- [Product requirements](PRD.md) for product direction and planned behavior.
- [Architecture decision records](adr/) for the rationale behind public contracts and execution boundaries.
