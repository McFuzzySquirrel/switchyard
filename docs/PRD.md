# Switchyard

## 1. Overview

**Product Name:** Switchyard  
**Summary:** A local, cross-platform CLI that discovers coding-agent harnesses installed on a machine, normalizes and verifies their capabilities, routes tasks to a suitable harness, and composes harnesses for workflows such as implementation followed by review. The product treats capabilities—not vendors or agents—as the unit of orchestration.  
**Target Platform:** Developer workstations and later CI environments on macOS, Linux, and Windows.  
**Key Constraints:** Local-first operation; no telemetry by default; credentials remain owned by the selected harness; deterministic and explainable routing; subprocess isolation and cancellation; extensible adapters.

## 2. Version History

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 0.1 | 2026-09-07 | Copilot | Initial PRD based on capability-driven multi-harness research and clarified MVP scope |

## 3. Goals and Non-Goals

### 3.1 Goals

- Discover supported local harness executables and their advertised CLI capabilities.
- Normalize vendor-specific commands and options into a stable capability vocabulary.
- Persist a local registry containing harness identity, version, capabilities, and discovery/verification status.
- Accept task requirements and deterministically select the best qualifying harness.
- Explain candidate evaluation and selection decisions.
- Verify important capabilities with bounded, opt-in probes.
- Execute selected tasks with safe timeout, cancellation, output-capture, and exit-status handling.
- Demonstrate composition using implementation by one harness and review by another.
- Provide a clear extension point for future harness adapters.

### 3.2 Non-Goals

- Replacing OpenCode, GitHub Copilot CLI, Claude, Gemini, Codex, or other harnesses.
- Implementing an LLM-based planner in the MVP.
- Building a hosted orchestration service or central telemetry backend.
- Managing, exporting, or storing harness credentials.
- Guaranteeing semantic equivalence between different harnesses.
- Automatically retrying or falling back to another harness without explicit policy.
- Providing a graphical user interface in the initial release.

## 4. User Stories / Personas

### 4.1 Personas

| Persona | Description | Key Needs |
|---------|-------------|-----------|
| Local Developer | Uses multiple coding-agent CLIs and wants the right tool selected for each task | Simple commands, predictable routing, transparent explanations |
| Workflow Author | Defines repeatable implementation, exploration, and review workflows | Capability requirements, composition, machine-readable output |
| Team Maintainer | Standardizes local/CI automation across a team | Portable configuration, adapter extensibility, reliable failure behavior |

### 4.2 User Stories

| ID | As a... | I want to... | So that... | Priority |
|----|---------|-------------|-----------|----------|
| US-01 | Local Developer | discover installed harnesses | I know what execution options are available | Must |
| US-02 | Local Developer | inspect normalized capabilities | I can understand harness strengths without memorizing vendor CLIs | Must |
| US-03 | Workflow Author | declare task capability requirements | routing is based on needs rather than vendor names | Must |
| US-04 | Local Developer | run a task through Switchyard | the best qualifying harness executes it | Must |
| US-05 | Local Developer | see why a harness was selected | routing is explainable and debuggable | Must |
| US-06 | Team Maintainer | run non-interactively | workflows can execute in CI or scripts | Must |
| US-07 | Local Developer | verify advertised capabilities | routing reflects what actually works in the environment | Should |
| US-08 | Workflow Author | compose implementation and review stages | specialized harnesses can contribute to one workflow | Should |
| US-09 | Team Maintainer | add a harness adapter | new tools can be supported without changing core routing | Must |
| US-10 | Local Developer | receive actionable errors | missing, incompatible, or failed harnesses are diagnosable | Must |
| US-11 | Workflow Author | opt into fallback behavior | resilience is controlled rather than surprising | Should |
| US-12 | Team Maintainer | inspect machine-readable results | external automation can consume discovery and run outcomes | Should |

## 5. Research Findings

The source research document, `docs/research/Research Idea Capability-Driven Multi-Harness Execution.md`, establishes the central hypothesis that capabilities are a more stable orchestration contract than harness identity.

Key findings:

- `--help` and related version probes can provide a low-cost discovery mechanism, but advertised support is not proof of operational availability.
- Discovery and verification should be separate states.
- A common capability vocabulary is required to compare fundamentally different CLIs.
- Deterministic matching is preferable to an LLM in the first version because it is explainable, testable, and reproducible.
- Thin adapters should isolate vendor-specific invocation, parsing, resume, fork, and output behavior.
- OpenCode and GitHub Copilot CLI provide a compelling initial composition pair: exploratory or fork-capable work can be followed by GitHub-aware implementation or review.
- The smallest useful demonstration is discovery, capability-based routing, and implementation-plus-review composition.

Technology research performed for this PRD:

| Technology | Verified current information | Decision |
|------------|------------------------------|----------|
| Node.js | Node.js v24.20.0 is listed as LTS; v26.8.1 is Current as of 2026-09-07 | Target Node.js 24 LTS for broad stability |
| TypeScript | npm latest reported 7.0.2 | Use TypeScript; align dependencies during implementation |
| tsx | npm latest reported 4.23.13 | Use for local TypeScript CLI execution/tests if retained |
| cross-spawn | npm latest reported 7.0.6 | Use for portable subprocess launch behavior |
| gray-matter | npm latest reported 4.0.3 | Reuse only where metadata parsing is needed |
| GitHub Copilot CLI | Installed environment reports 1.0.83 | Adapter must discover rather than assume feature flags |
| OpenCode | Installed environment reports 1.18.28 | Adapter must discover rather than assume feature flags |

## 6. Concept

### 6.1 Core Loop / Workflow

1. User installs or makes one or more harness CLIs available on `PATH`.
2. User runs `switchyard discover`.
3. Switchyard locates configured executables, queries version/help metadata, and parses known commands/options.
4. Switchyard maps observations into normalized capabilities with discovery confidence.
5. Optional verification probes test selected capabilities under bounded permissions and timeouts.
6. User runs `switchyard run --requires=headless,repository-access "..."`.
7. Switchyard evaluates registered harnesses against requirements and policy.
8. Switchyard explains candidates, selects a harness, and invokes its adapter.
9. Switchyard emits human-readable and optional JSON results.
10. A composition workflow may pass artifacts or context from one harness stage to another.

```text
Task requirements
      |
      v
Capability matcher
      |
      v
Registry: discovered + verified harnesses
      |
      +--> OpenCode adapter
      |
      +--> Copilot adapter
      |
      +--> Future adapters
```

### 6.2 Success / Completion Criteria

From a user's perspective, the MVP is complete when:

- `switchyard discover` identifies installed OpenCode and Copilot CLIs or reports why they are unavailable.
- `switchyard capabilities` presents normalized capabilities and status.
- `switchyard run --requires=...` selects a qualifying harness deterministically.
- `switchyard explain` shows required capabilities, candidate matches, verification state, and the selection reason.
- A selected task executes with captured status/output and clear failure reporting.
- A documented implementation-plus-review demonstration runs through two harnesses.

## 7. Technical Architecture

### 7.1 Technology Stack

| Component | Technology / Version | Notes |
|-----------|----------------------|-------|
| Runtime | Node.js 24 LTS | Cross-platform subprocess and filesystem support |
| Language | TypeScript 7.0.2 | Strict typing required |
| Module system | ESM | Matches repository conventions |
| CLI execution | Existing repository CLI conventions; `tsx` 4.23.13 for development | Final package should provide a runnable CLI entry point |
| Process execution | Node child-process APIs plus `cross-spawn` 7.0.6 | Must support Windows command shims and POSIX process groups |
| Configuration/registry | Local JSON files with atomic writes | No hosted service required |
| Metadata parsing | `gray-matter` 4.0.3 only if existing document metadata integration requires it | Avoid unnecessary dependency growth |
| Testing | Node test runner with existing TypeScript test conventions | Unit, integration, and subprocess tests |
| Initial adapters | OpenCode 1.18.28 and GitHub Copilot CLI 1.0.83 observed locally | Runtime discovery remains authoritative; versions are not hard-coded |

### 7.2 Project Structure

```text
.github/
  skills/                       # Existing repository automation
  ...
src/
  cli.ts
  commands/
    discover.ts
    capabilities.ts
    explain.ts
    run.ts
  discovery/
    executable.ts
    help-parser.ts
    registry.ts
  capabilities/
    vocabulary.ts
    matcher.ts
    scoring.ts
  harness/
    adapter.ts
    process.ts
    opencode-adapter.ts
    copilot-adapter.ts
  verification/
    probe.ts
    policies.ts
  composition/
    workflow.ts
  config/
    config.ts
    paths.ts
  output/
    human.ts
    json.ts
tests/
docs/
  PRD.md
  research/
```

The final location may adapt to existing repository conventions, but core responsibilities must remain separable.

### 7.3 Key APIs / Interfaces

```ts
type CapabilityName =
  | "headless"
  | "model-selection"
  | "continue"
  | "fork"
  | "mcp"
  | "repository-access"
  | "github-context"
  | "parallel-execution"
  | "local-models";

interface HarnessAdapter {
  id: string;
  discover(): Promise<HarnessProfile>;
  verify(capabilities: CapabilityName[], context: ProbeContext): Promise<VerificationResult[]>;
  execute(request: ExecutionRequest): Promise<ExecutionResult>;
  resume?(request: ResumeRequest): Promise<ExecutionResult>;
  fork?(request: ForkRequest): Promise<ForkResult>;
}

interface HarnessProfile {
  id: string;
  displayName: string;
  executable: string;
  version?: string;
  capabilities: CapabilityObservation[];
}

interface TaskRequirements {
  requires: CapabilityName[];
  preferredHarness?: string;
  allowFallback?: boolean;
}
```

## 8. Functional Requirements

### 8.1 Discovery and Registry

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-01 | Locate configured harness executables using platform-appropriate `PATH` resolution and explicit executable overrides | Must |
| FR-02 | Query each executable for version information without starting an interactive session | Must |
| FR-03 | Query each executable's help or capability metadata using bounded subprocess execution | Must |
| FR-04 | Parse known commands, flags, and documented features into observations | Must |
| FR-05 | Normalize observations into a versioned capability vocabulary | Must |
| FR-06 | Record discovery status, source evidence, timestamps, executable path, and version | Must |
| FR-07 | Persist the local registry atomically and reload it on subsequent commands | Must |
| FR-08 | Support refreshing one harness or the complete registry | Should |
| FR-09 | Report unavailable or malformed harnesses without hiding other discovery results | Must |

### 8.2 Matching and Routing

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-10 | Accept task capability requirements from CLI flags and a machine-readable workflow input | Must |
| FR-11 | Determine whether each candidate satisfies all required capabilities | Must |
| FR-12 | Rank qualifying candidates using deterministic documented rules | Must |
| FR-13 | Prefer verified capabilities over merely discovered capabilities when otherwise equivalent | Should |
| FR-14 | Support explicit preferred-harness and fallback policy controls | Should |
| FR-15 | Fail with a distinct, actionable error when no candidate qualifies | Must |
| FR-16 | Explain candidate matches, missing capabilities, score, and final selection | Must |

### 8.3 Execution and Composition

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-17 | Execute a selected task through the selected adapter with working directory and environment controls | Must |
| FR-18 | Capture stdout, stderr, exit status, duration, and failure category | Must |
| FR-19 | Support timeout and cancellation that terminate child processes and descendants safely | Must |
| FR-20 | Provide human-readable output and stable JSON output for automation | Should |
| FR-21 | Run an implementation-plus-review composition workflow across two adapters | Should |
| FR-22 | Pass explicitly declared artifacts or context between composition stages | Should |
| FR-23 | Preserve stage-level results when a later composition stage fails | Should |
| FR-24 | Expose adapter capability boundaries so unsupported operations are rejected before execution | Must |

### 8.4 Extensibility and Operations

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-25 | Define an adapter contract that permits future harnesses without modifying the matcher | Must |
| FR-26 | Support configuration of known harnesses, executable overrides, probe policy, and registry location | Must |
| FR-27 | Provide command exit codes that distinguish success, no match, invalid input, unavailable harness, and execution failure | Must |
| FR-28 | Document how to add and test a new adapter | Should |
| FR-29 | Support a dry-run/explain-only mode that never launches the selected task | Should |

## 9. Non-Functional Requirements

| ID | Requirement | Priority |
|----|-------------|----------|
| NF-01 | Discovery and routing output must be deterministic for the same inputs, registry, and harness responses | Must |
| NF-02 | Normal discovery must return within 10 seconds per harness excluding explicitly configured long-running probes | Should |
| NF-03 | Every subprocess must have bounded output buffers, timeout behavior, and cancellation handling | Must |
| NF-04 | The CLI must support non-interactive operation suitable for scripts and CI | Must |
| NF-05 | The core matcher and registry logic must be platform-independent and testable without installed harnesses | Must |
| NF-06 | Human-readable output must remain understandable in plain terminals and support no-color mode | Must |
| NF-07 | JSON output schemas must be versioned or backward-compatible once published | Should |
| NF-08 | The codebase must use strict TypeScript checks and avoid unsafe type assertions | Must |
| NF-09 | Registry writes must be atomic and resilient to interruption | Must |
| NF-10 | The system must not require a hosted control plane or telemetry service | Must |

## 10. Security and Privacy

| ID | Requirement | Priority |
|----|-------------|----------|
| SP-01 | Do not collect or transmit telemetry by default | Must |
| SP-02 | Never persist, print, or forward harness credentials, tokens, or secret environment values | Must |
| SP-03 | Pass environment variables to child processes according to an explicit allow/deny policy and document inheritance behavior | Must |
| SP-04 | Treat task prompts, repository paths, and harness output as potentially sensitive local data | Must |
| SP-05 | Restrict registry and run-state files to the invoking user's normal local permissions | Must |
| SP-06 | Do not execute discovered help text or registry content as shell code; invoke executables with argument arrays | Must |
| SP-07 | Verification probes must be opt-in or policy-controlled when they may mutate repositories, call external services, or consume paid model usage | Must |
| SP-08 | Log only redacted metadata in diagnostic output | Should |
| SP-09 | Document that selected harnesses may independently transmit task data under their own policies | Must |

No Switchyard service-side personal data is planned. Local prompts, outputs, paths, and registry metadata may contain sensitive information and must remain local unless the user explicitly invokes a harness that transmits them.

## 11. Accessibility

| ID | Requirement | Priority |
|----|-------------|----------|
| ACC-01 | All core operations must work without color, Unicode box drawing, or interactive prompts | Must |
| ACC-02 | Status and error messages must use text labels in addition to color or symbols | Must |
| ACC-03 | JSON output must expose equivalent information to human-readable output | Should |
| ACC-04 | Interactive behavior, if added later, must support keyboard navigation and screen-reader-compatible prompts | Should |
| ACC-05 | Documentation must describe terminal width, color, and non-interactive behavior | Should |

## 12. User Interface / Interaction Design

Primary commands:

```text
switchyard discover [--refresh] [--json]
switchyard capabilities [--verified] [--json]
switchyard explain --requires=<capability,...> [--json]
switchyard run --requires=<capability,...> [--allow-fallback] [--json] "<task>"
switchyard verify [--harness=<id>] [--capability=<name>]
switchyard compose <workflow-file> [--json]
```

Interaction principles:

- Print a concise summary first, followed by details only when useful.
- Make selection decisions visible and reproducible.
- Use stable exit codes.
- Send machine-readable output to stdout and diagnostics to stderr.
- Never prompt in headless mode.
- Require explicit confirmation or configuration for probes that may incur external model usage or mutate files.

## 13. System States / Lifecycle

```text
Unknown
  -> Discovered
  -> Verified
  -> Registered
  -> Eligible
  -> Selected
  -> Running
  -> Succeeded
  -> Failed
  -> Unavailable
```

State rules:

- `Discovered`: executable and advertised metadata were obtained.
- `Verified`: one or more requested capabilities passed a bounded probe.
- `Registered`: profile is persisted locally.
- `Eligible`: profile satisfies the current task requirements and policy.
- `Selected`: deterministic matcher chose the profile.
- `Running`: adapter launched the task.
- `Succeeded` / `Failed`: execution completed with captured result.
- `Unavailable`: executable could not be found, started, or queried.
- A stale registry entry may remain registered but must not be treated as verified without a valid verification record.

## 14. Implementation Phases

### Phase 1: Discovery and Registry MVP
- [ ] Establish TypeScript/Node CLI entry point using repository conventions.
- [ ] Define capability vocabulary, profile schema, and registry schema.
- [ ] Implement executable lookup, version probing, and help capture.
- [ ] Implement OpenCode and Copilot discovery adapters.
- [ ] Implement atomic local registry persistence.
- [ ] Implement `discover` and `capabilities` commands.
- [ ] Add fixtures for installed, missing, malformed, and platform-specific executables.

### Phase 2: Deterministic Routing and Execution
- [ ] Define task requirement and selection policy schemas.
- [ ] Implement capability matching and deterministic ranking.
- [ ] Implement `explain` output and stable exit codes.
- [ ] Implement adapter execution with timeout, cancellation, output limits, and process-tree cleanup.
- [ ] Implement `run` with human-readable and JSON output.
- [ ] Add dry-run behavior and no-match diagnostics.

### Phase 3: Verification and Resilience
- [ ] Define safe probe categories and verification policy.
- [ ] Implement bounded capability probes and verification records.
- [ ] Incorporate verification state into routing.
- [ ] Add explicit opt-in fallback and preferred-harness policy.
- [ ] Add stale registry handling and refresh behavior.
- [ ] Document security implications of probes and fallback.

### Phase 4: Composition and Demonstration
- [ ] Define workflow format for sequential composition.
- [ ] Implement artifact/context handoff between stages.
- [ ] Implement implementation-plus-review workflow using OpenCode and Copilot.
- [ ] Preserve per-stage logs, statuses, and outputs.
- [ ] Produce a reproducible example repository/workflow.
- [ ] Document limitations and future intelligent planning.

## 15. Testing Strategy

| Level | Scope | Tools / Approach |
|-------|-------|------------------|
| Unit Tests | Capability normalization, matching, ranking, schemas, exit-code mapping | Node test runner with TypeScript fixtures |
| Integration Tests | Discovery, registry persistence, adapter invocation, JSON output | Temporary directories and stub executables |
| Process Tests | Timeouts, cancellation, output limits, child-process cleanup | Cross-platform subprocess fixtures |
| Adapter Tests | OpenCode/Copilot argument construction and help parsing | Captured CLI fixtures plus installed-tool smoke tests |
| Composition Tests | Stage sequencing, context handoff, partial failure | Stub adapters and artifact fixtures |
| Manual / Exploratory | CLI readability and real harness workflows | macOS/Linux/Windows terminal checks |
| Performance | Discovery latency and routing overhead | Benchmarks against multiple registered harnesses |
| Security | Secret redaction, argument-array execution, registry permissions | Adversarial fixtures and filesystem checks |

Key scenarios:

1. No harnesses installed.
2. One harness installed and qualifying.
3. Multiple qualifying harnesses with a deterministic tie.
4. Required capability missing from every harness.
5. Advertised capability fails verification.
6. Harness exits non-zero.
7. Harness times out or is cancelled.
8. Child process descendants are cleaned up.
9. Registry is interrupted during write.
10. JSON output remains parseable on success and failure.
11. Composition stage 1 succeeds and stage 2 fails.
12. A new adapter can be added without changing the matcher.

## 16. Analytics / Success Metrics

No telemetry is planned for the initial release. Success will be measured locally and through project validation.

| Metric | Target | Measurement Method |
|--------|--------|--------------------|
| Initial discovery success | Correctly identifies each installed supported harness | Fixture and manual smoke tests |
| Routing correctness | 100% of conformance cases select a qualifying harness or fail clearly | Automated matcher suite |
| Explainability | Every selection has a machine-readable reason | JSON schema assertions |
| Process safety | No orphaned child processes after timeout/cancel tests | Process integration tests |
| Composition proof | One documented implementation-plus-review workflow completes | Reproducible demonstration |
| Extensibility | A third-party/stub adapter can be added without matcher changes | Adapter conformance test |

## 17. Acceptance Criteria

1. The CLI runs on supported macOS, Linux, and Windows environments with Node.js 24 LTS.
2. `discover` finds configured OpenCode and Copilot executables or reports actionable unavailable states.
3. Discovery records executable path, version where available, evidence, capabilities, and timestamps.
4. Capability names are normalized independently of vendor-specific flag names.
5. The registry is persisted locally using atomic writes and contains no credentials.
6. `run` accepts required capabilities and never selects a candidate missing a required capability.
7. Ranking and tie-breaking are deterministic and documented.
8. `explain` reports requirements, candidate status, missing capabilities, verification state, and selection reason.
9. Execution captures stdout, stderr, status, duration, and categorized failures.
10. Timeout and cancellation clean up child processes and descendants.
11. No-match, invalid-input, unavailable-harness, and execution-failure cases have distinct documented exit codes.
12. JSON output is parseable and contains equivalent decision/result information.
13. Verification probes are bounded and policy-controlled.
14. Fallback is never implicit and only occurs when explicitly enabled.
15. A composition workflow executes implementation and review stages across two harnesses.
16. Unit, integration, process, and composition tests cover the key scenarios in Section 15.
17. Documentation explains installation, discovery, routing, adapter extension, privacy, and probe risks.
18. A stub adapter can be registered and routed without changes to core matching logic.

## 18. Dependencies and Risks

### 18.1 Dependencies

| Dependency | Type | Risk if Unavailable | Mitigation |
|------------|------|---------------------|------------|
| Node.js 24 LTS | Runtime | CLI cannot execute | Document supported runtime and provide clear startup error |
| OpenCode CLI | External harness | Initial composition path unavailable | Discovery reports absence; use stub fixtures for tests |
| GitHub Copilot CLI | External harness | Review/GitHub-aware path unavailable | Discovery reports absence; keep adapter optional |
| OS process APIs | Platform | Execution/cancellation differences | Adapter process layer with platform-specific tests |
| User repository permissions | Environment | Harness cannot modify or inspect target | Surface original errors and document required permissions |

### 18.2 Risks

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| CLI help output changes between harness versions | High | Discovery becomes incomplete or inaccurate | Versioned parsers, evidence retention, fixture updates, verification layer |
| Advertised capabilities do not work in a user environment | High | Incorrect routing or failed execution | Separate discovered/verified states and safe probes |
| Harnesses expose incompatible interaction models | High | Composition is difficult | Thin adapters and explicit capability boundaries |
| Model execution consumes money or external quota during probes | Medium | Unexpected cost | Opt-in probe policy and clear warnings |
| Child-process cleanup differs by OS | Medium | Orphaned processes or hangs | Dedicated process runner and platform test matrix |
| Local output contains secrets | Medium | Credential or data exposure | Redaction, no telemetry, controlled environment inheritance |
| Capability vocabulary becomes too vendor-specific | Medium | Poor extensibility | Stable abstract vocabulary with adapter-local evidence |
| Deterministic ranking may not reflect task quality | Medium | Suboptimal harness choice | Explainable policy first; future planner/feedback remains separate |

## 19. Future Considerations

| Item | Description | Potential Version |
|------|-------------|-------------------|
| Intelligent planning | Use an LLM to translate natural-language tasks into capability requirements | v2 |
| Parallel fork orchestration | Run multiple candidate implementations and compare results | v2 |
| More harness adapters | Claude, Gemini, Codex, Pi, and other compatible CLIs | v2+ |
| Remote/hosted runners | Execute harnesses on remote machines or CI workers | v3 |
| Capability marketplace | Share adapter definitions and capability schemas | TBD |
| Quality-based routing | Rank based on historical task outcomes or user feedback | v3 |
| Interactive TUI | Terminal UI for registry inspection and workflow control | TBD |
| Capability negotiation protocol | A formal adapter protocol beyond help-text parsing | TBD |

## 20. Open Questions

| # | Question | Default Assumption |
|---|----------|--------------------|
| 1 | Should the product be published as an npm package or remain repository-local initially? | Start repository-local; define packaging boundaries so npm distribution can follow. |
| 2 | What exact capability vocabulary is required beyond the initial research examples? | Start with the vocabulary in Section 7.3 and add capabilities only with a concrete adapter use case. |
| 3 | Should discovery parse only `--help`, or also inspect shell completion/manifests/version-specific metadata? | Start with version and help output; add other sources behind adapter interfaces. |
| 4 | What verification probes are safe for each harness? | Default to read-only, bounded probes; require explicit opt-in for model invocation or mutation. |
| 5 | Where should registry data live? | Use an OS-appropriate user config/cache directory with an environment override. |
| 6 | Should task prompts be passed as argv, stdin, files, or harness-specific combinations? | Adapters choose the safest supported transport; avoid shell interpolation. |
| 7 | What artifact format should composition stages exchange? | Start with declared files plus metadata manifest; avoid copying opaque conversation state. |
| 8 | What is the exact fallback ranking policy? | Prefer verified full matches, then discovered full matches; fallback only when explicitly enabled. |
| 9 | Which CI platforms are required for release confidence? | Cover Linux, macOS, and Windows in CI when packaging begins. |
| 10 | Should third-party adapters be loaded dynamically from configuration? | Start with built-in adapters and a documented adapter contract; defer dynamic loading until trust boundaries are defined. |
| 11 | How should harness authentication failures be classified? | Treat them as adapter execution/configuration failures and preserve the harness's actionable message without exposing secrets. |
| 12 | Is a local registry shared between users or environments? | Per-user and per-machine by default; no shared registry or telemetry. |

## 21. Glossary

| Term | Definition |
|------|------------|
| Harness | A coding-agent CLI capable of executing development tasks |
| Adapter | Switchyard integration that discovers, verifies, and invokes one harness |
| Capability | An abstract operation or property required by a task, such as `fork` or `headless` |
| Discovery | Inferring advertised harness capabilities from executable metadata |
| Verification | Testing whether an advertised capability actually works in the current environment |
| Registry | Local persisted collection of harness profiles and capability observations |
| Requirement | A capability that a task declares it needs |
| Composition | A workflow that runs multiple harness stages and transfers declared context or artifacts |
| Probe | A bounded verification operation used to test a capability |
| Fallback | Explicitly permitted selection of another qualifying harness after a preferred option is unavailable or fails |
