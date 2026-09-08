# Switchyard User Guide

Switchyard finds installed coding-agent CLIs, records what they advertise, and
routes a prompt to the best qualifying harness.

Use this guide for the common path:

1. Install and discover harnesses.
2. Inspect or explain the routing decision.
3. Preview a prompt.
4. Run the prompt through the selected agent.

For the project overview, see the [README](../README.md). For adapter
implementation details, see the [Adapter Development Guide](adapter-development.md).

## Install

Switchyard requires Node.js 24 or newer.

```sh
npm install
```

When running from this private repository checkout, use:

```sh
npm run switchyard -- --help
```

Installed consumers can use `npx switchyard`. In the examples below, replace
`npx switchyard` with `npm run switchyard --` when working in this checkout.

## Discover harnesses

Refresh the local registry after installing or changing a provider:

```sh
npx switchyard discover --refresh
```

Use JSON when another script will consume the result:

```sh
npx switchyard discover --refresh --json
```

Discovery checks the configured OpenCode and GitHub Copilot executables. A
profile includes normalized routing capabilities and a
`providerCapabilities` inventory of provider-specific commands, options,
providers, and help topics.

## See what will be selected

List the cached profiles:

```sh
npx switchyard capabilities
npx switchyard capabilities --json
```

Explain a decision without launching an agent:

```sh
npx switchyard explain --requires=headless,repository-access
npx switchyard explain --requires=headless --json
```

Every requirement is required. The explanation shows which harnesses qualify,
what is missing, and why the selected harness wins.

Prefer one harness, but allow another qualifying harness as a fallback:

```sh
npx switchyard explain \
  --requires=headless \
  --preferred-harness=opencode \
  --allow-fallback
```

## Run an agent prompt

The simplest prompt is a positional task:

```sh
npx switchyard prompt \
  "Inspect the failing tests and explain the first fix."
```

When `--requires` is omitted in an interactive terminal, Switchyard refreshes
discovery if needed and shows one consolidated checkbox-style list of the
normalized capabilities currently available. Select one or more entries, then
Switchyard routes the prompt without requiring you to know provider names or
remember the capability vocabulary.

For scripts, CI, JSON output, or non-TTY use, provide requirements explicitly:

```sh
npx switchyard prompt \
  --requires=headless \
  --json \
  "Inspect the failing tests and explain the first fix."
```

`prompt` is an alias for `run`; it exists to make the agent-oriented workflow
obvious. The equivalent explicit command is:

```sh
npx switchyard run --requires=headless "Inspect the failing tests and explain the first fix."
```

The command first applies the same deterministic routing policy used by
`explain`, then invokes the selected adapter with the prompt. OpenCode uses
`opencode run`; GitHub Copilot uses its non-interactive `--prompt` mode.

Preview the exact selection without starting an agent:

```sh
npx switchyard prompt \
  --requires=headless \
  --dry-run \
  --json \
  "Inspect the failing tests and explain the first fix."
```

Run in a specific repository with a bounded execution time:

```sh
npx switchyard prompt \
  --requires=headless,repository-access \
  --cwd ./my-repository \
  --timeout-ms 120000 \
  "Run the test suite and fix the first failure."
```

To see the full workflow with live OpenCode and GitHub Copilot execution, run
the [Live Routing Exercise](examples/live-routing-exercise.md). It uses a
disposable workspace and records the implementation and review stages.

To see a capability-specific route, run the [Fork Capability Routing
Exercise](examples/fork-capability-routing.md). It requires `fork` and shows
OpenCode selected without naming it as a preferred harness.

Both exercises include terminal-style GIF and MP4 recordings. Regenerate them
with `./examples/record-terminal-demos.sh` from the repository root when both
live providers are available.

Use `--json` when a wrapper script needs the selected harness, status, output,
or failure category:

```sh
npx switchyard prompt --requires=headless --json "Summarize this repository."
```

> [!WARNING]
> A real prompt can modify files, run commands, access external services, or
> incur provider costs according to the selected provider's permissions. Use
> `--dry-run` first when testing routing, and configure provider permissions
> deliberately.

## Command reference

| Command | Use it for |
| --- | --- |
| `discover` | Probe installed harnesses and update the registry |
| `capabilities` | Read cached normalized and provider-specific capabilities |
| `explain` | Inspect a routing decision without execution |
| `prompt` / `run` | Route and execute a prompt |
| `verify` | Run an approved capability probe |
| `compose` | Execute a declared multi-stage workflow |

Common options:

| Option | Commands | Purpose |
| --- | --- | --- |
| `--requires <a,b>` | `explain`, `prompt`, `run` | Require all listed capabilities |
| `--preferred-harness <id>` | `explain`, `prompt`, `run` | Prefer a qualifying harness |
| `--allow-fallback` | `explain`, `prompt`, `run` | Permit fallback from the preferred harness |
| `--dry-run` | `prompt`, `run` | Show routing without launching a process |
| `--cwd <path>` | `prompt`, `run` | Set the agent working directory |
| `--timeout-ms <ms>` | `prompt`, `run` | Bound execution time |
| `--registry <path>` | all applicable commands | Use a specific registry file |
| `--config <path>` | all applicable commands | Use a specific configuration file |
| `--json` | all commands | Emit the versioned machine-readable result |

See the complete list with:

```sh
npx switchyard --help
```

## Configuration

Pin provider executables or the registry path in a local JSON file:

```json
{
  "schemaVersion": 1,
  "registryPath": "./.switchyard/registry.json",
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

Use it with:

```sh
npx switchyard discover --refresh --config ./switchyard.config.json
```

Resolution order is:

1. Explicit command-line value
2. Environment variable
3. Configuration file
4. Built-in default

Useful variables include `SWITCHYARD_CONFIG_PATH`,
`SWITCHYARD_REGISTRY_PATH`, `SWITCHYARD_OPENCODE_EXECUTABLE`,
`SWITCHYARD_COPILOT_EXECUTABLE`, and
`SWITCHYARD_PROBE_TIMEOUT_MS`.

## How selection works

Switchyard routes only on the normalized capability vocabulary. Provider-specific
inventory is preserved for inspection but does not silently become a routing
requirement.

Discovery and verification are separate:

- **Discovery** records what help/version output advertises.
- **Verification** records the result of an approved bounded probe.
- Verified qualifying candidates rank ahead of discovery-only candidates.
- Harness ID is the deterministic tie-breaker.

The registry is cached locally. Refresh it after installing a provider:

```sh
npx switchyard discover --refresh --json
```

## Troubleshooting

### No harness is found

```sh
npx switchyard discover --refresh --json
```

Check the executable path or set `SWITCHYARD_OPENCODE_EXECUTABLE` /
`SWITCHYARD_COPILOT_EXECUTABLE`.

### The result is `no-match`

Inspect the missing capabilities:

```sh
npx switchyard explain --requires=headless --json
```

Requirements are all-required. Remove an incorrect requirement or configure a
harness that advertises it.

### The result is `unavailable`

The selected adapter cannot execute the request, or the executable is missing.
Run the prompt with `--dry-run` to inspect routing independently, then check
the provider executable and adapter support.

### The agent waits for input

Use the provider's non-interactive mode through `prompt`/`run`, provide a
bounded timeout, and configure provider permissions before execution. Do not
parse interactive output as a stable API; use `--json`.

## Workflows and development

Use `compose` for multi-stage work that declares dependencies and artifact
handoffs:

```sh
npx switchyard compose ./examples/opencode-to-copilot.workflow.json --json
```

For adapter development, testing requirements, lifecycle contracts, and
security boundaries, see the [Adapter Development Guide](adapter-development.md).
For the project roadmap and design decisions, see the documents in
[`docs/adr`](adr/).
