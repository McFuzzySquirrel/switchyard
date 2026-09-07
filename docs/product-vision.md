# Product Vision: Switchyard

## 1. Overview

**Product Name:** Switchyard  
**Summary:** A local, cross-platform CLI that discovers coding-agent harnesses, normalizes and verifies their capabilities, routes tasks to suitable harnesses, and composes harnesses for workflows such as implementation followed by review.  
**Target Platform:** Developer workstations and later CI environments on macOS, Linux, and Windows.  
**Key Constraints:** Local-first operation, no telemetry by default, no credential storage, deterministic and explainable routing, safe subprocess handling, and extensible adapters.  
**Original PRD:** [docs/PRD.md](PRD.md)

## 2. Version History

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0 | 2026-09-07 | Copilot | Initial product vision decomposed from PRD |

## 3. Goals and Non-Goals

### 3.1 Goals

- Discover local harnesses and advertised capabilities.
- Normalize capabilities into a stable vocabulary.
- Persist local registry and verification state.
- Route tasks deterministically and explain decisions.
- Verify capabilities with bounded probes.
- Execute safely with timeout, cancellation, and output capture.
- Compose multiple harnesses.
- Support future adapters without changing core routing.

### 3.2 Non-Goals

- Replacing or abstracting away the harnesses themselves.
- LLM-based planning in the MVP.
- Hosted orchestration or central telemetry.
- Credential management.
- Semantic equivalence guarantees between harnesses.
- Implicit fallback or an initial graphical interface.

## 4. Personas

| Persona | Description | Key Needs |
|---------|-------------|-----------|
| Local Developer | Uses multiple coding-agent CLIs | Simple commands, predictable routing, transparent explanations |
| Workflow Author | Defines implementation, exploration, and review workflows | Requirements, composition, machine-readable output |
| Team Maintainer | Standardizes local and CI automation | Portable configuration, extensibility, reliable failures |

## 5. Research Findings

The source research document is `docs/research/Research Idea Capability-Driven Multi-Harness Execution.md`.

- Capabilities are a more stable orchestration contract than vendor identity.
- Help output is useful for discovery but does not prove runtime support.
- Discovery and verification should be separate states.
- Deterministic matching is the appropriate first implementation.
- Thin adapters isolate vendor-specific invocation and lifecycle operations.
- OpenCode and GitHub Copilot CLI form a compelling initial composition pair.

Verified technology information used by the PRD:

| Technology | Verified information | Decision |
|------------|----------------------|----------|
| Node.js | v24.20.0 listed as LTS; v26.8.1 Current on 2026-09-07 | Target Node.js 24 LTS |
| TypeScript | npm latest 7.0.2 | Use strict TypeScript |
| tsx | npm latest 4.23.13 | Retain for development if needed |
| cross-spawn | npm latest 7.0.6 | Use for portable process launching |
| gray-matter | npm latest 4.0.3 | Reuse only where metadata parsing requires it |

## 6. Technical Architecture

### 6.1 Technology Stack

| Component | Technology / Version | Notes |
|-----------|----------------------|-------|
| Runtime | Node.js 24 LTS | Cross-platform CLI runtime |
| Language | TypeScript 7.0.2 | Strict typing |
| Modules | ESM | Existing repository convention |
| Process execution | Node child-process APIs and cross-spawn 7.0.6 | Windows shims and POSIX process groups |
| Registry | Local JSON with atomic writes | No hosted service |
| Testing | Existing Node test runner conventions | Unit, integration, and process tests |

### 6.2 Project Structure

```text
src/
  cli.ts
  commands/
  discovery/
  capabilities/
  harness/
  verification/
  composition/
  config/
  output/
tests/
docs/
```

### 6.3 Key APIs / Interfaces

The core interfaces are `CapabilityName`, `HarnessAdapter`, `HarnessProfile`, and `TaskRequirements`, as defined in PRD Section 7.3. Adapters discover, verify, and execute; the matcher remains vendor-neutral.

## 7. Non-Functional Requirements

| ID | Requirement | Priority |
|----|-------------|----------|
| NF-01 | Discovery and routing are deterministic for identical inputs | Must |
| NF-02 | Normal discovery returns within 10 seconds per harness, excluding configured long probes | Should |
| NF-03 | Subprocesses have bounded buffers, timeouts, and cancellation | Must |
| NF-04 | Non-interactive operation supports scripts and CI | Must |
| NF-05 | Core matcher and registry are platform-independent and testable without installed harnesses | Must |
| NF-06 | Human output works in plain terminals and no-color mode | Must |
| NF-07 | Published JSON schemas remain versioned or backward-compatible | Should |
| NF-08 | Strict TypeScript checks and no unsafe assertions | Must |
| NF-09 | Registry writes are atomic and interruption-resilient | Must |
| NF-10 | No hosted control plane or telemetry dependency | Must |

## 8. Security and Privacy

| ID | Requirement | Priority |
|----|-------------|----------|
| SP-01 | No telemetry or transmission by default | Must |
| SP-02 | Never persist, print, or forward credentials or secret environment values | Must |
| SP-03 | Child-process environment inheritance follows an explicit policy | Must |
| SP-04 | Prompts, paths, and output are treated as potentially sensitive | Must |
| SP-05 | Registry and run-state files use normal user permissions | Must |
| SP-06 | Help and registry content are never executed as shell code | Must |
| SP-07 | Potentially mutating, external, or paid probes are policy-controlled | Must |
| SP-08 | Diagnostics redact sensitive metadata | Should |
| SP-09 | Documentation explains that harnesses may transmit data under their own policies | Must |

## 9. Accessibility

| ID | Requirement | Priority |
|----|-------------|----------|
| ACC-01 | Core operations work without color, Unicode, or prompts | Must |
| ACC-02 | Status and errors use text labels as well as visual styling | Must |
| ACC-03 | JSON exposes equivalent information to human output | Should |
| ACC-04 | Future interactive behavior supports keyboard and screen readers | Should |
| ACC-05 | Documentation describes terminal and non-interactive behavior | Should |

## 10. System States / Lifecycle

```text
Unknown -> Discovered -> Verified -> Registered -> Eligible
Eligible -> Selected -> Running -> Succeeded
Running -> Failed
Unknown/Discovered/Registered -> Unavailable
```

Stale registered entries must not be treated as verified without a valid verification record.

## 11. Analytics / Success Metrics

No telemetry is planned. Success is measured through local validation:

| Metric | Target | Measurement Method |
|--------|--------|--------------------|
| Discovery success | Correctly identifies installed supported harnesses | Fixtures and smoke tests |
| Routing correctness | 100% of conformance cases select or fail clearly | Matcher suite |
| Explainability | Every selection has a machine-readable reason | JSON assertions |
| Process safety | No orphaned children after cancellation | Process tests |
| Composition proof | One implementation-plus-review workflow completes | Reproducible demonstration |
| Extensibility | Stub adapter added without matcher changes | Adapter conformance test |

## 12. Dependencies and Risks

### 12.1 Dependencies

| Dependency | Type | Risk if Unavailable | Mitigation |
|------------|------|---------------------|------------|
| Node.js 24 LTS | Runtime | CLI cannot execute | Supported-runtime error |
| OpenCode CLI | External harness | Initial composition path unavailable | Optional adapter and stub fixtures |
| GitHub Copilot CLI | External harness | Review path unavailable | Optional adapter and stub fixtures |
| OS process APIs | Platform | Different cleanup behavior | Platform-specific process layer |
| Repository permissions | Environment | Harness cannot inspect or modify files | Preserve actionable errors |

### 12.2 Risks

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Harness help output changes | High | Discovery becomes inaccurate | Versioned parsers, evidence, verification |
| Advertised capability fails at runtime | High | Bad routing or execution failure | Separate discovery and verification |
| Incompatible harness interaction models | High | Composition difficulty | Thin adapters and explicit boundaries |
| Probes consume money or quota | Medium | Unexpected cost | Opt-in policy and warnings |
| OS cleanup differences | Medium | Orphans or hangs | Dedicated process runner and matrix tests |
| Local output contains secrets | Medium | Data exposure | Redaction and controlled inheritance |

## 13. Future Considerations

- LLM task-to-capability planning.
- Parallel fork orchestration.
- Additional harness adapters.
- Remote runners.
- Shared capability marketplace.
- Quality-based routing.
- Interactive TUI.
- Formal capability negotiation protocol.

## 14. Features

| # | Feature | File | Dependencies | Priority |
|---|---------|------|-------------|----------|
| 1 | Discovery and Registry | [features/discovery-and-registry.md](features/discovery-and-registry.md) | None | Must |
| 2 | Deterministic Routing and Explainability | [features/deterministic-routing-and-explainability.md](features/deterministic-routing-and-explainability.md) | Feature 1 | Must |
| 3 | Harness Execution Runtime | [features/harness-execution-runtime.md](features/harness-execution-runtime.md) | Features 1 and 2 | Must |
| 4 | Verification and Resilience | [features/verification-and-resilience.md](features/verification-and-resilience.md) | Features 1 and 2 | Should |
| 5 | Multi-Harness Composition | [features/multi-harness-composition.md](features/multi-harness-composition.md) | Features 3 and 6 | Should |
| 6 | Adapter Extensibility and Configuration | [features/adapter-extensibility-and-configuration.md](features/adapter-extensibility-and-configuration.md) | Feature 1 | Must |

### Feature Dependency Graph

```text
Discovery and Registry
  ├── Deterministic Routing and Explainability
  │     ├── Harness Execution Runtime
  │     │     └── Multi-Harness Composition
  │     └── Verification and Resilience
  └── Adapter Extensibility and Configuration
          └── Multi-Harness Composition
```

## 15. Glossary

| Term | Definition |
|------|------------|
| Harness | A coding-agent CLI capable of executing development tasks |
| Adapter | Integration that discovers, verifies, and invokes one harness |
| Capability | Abstract operation or property required by a task |
| Discovery | Inferring advertised capabilities from executable metadata |
| Verification | Testing whether an advertised capability works in the environment |
| Registry | Local persisted collection of harness profiles and observations |
| Composition | Workflow that runs multiple harness stages |
| Probe | Bounded operation used to test a capability |
| Fallback | Explicitly permitted alternate harness selection |

## 16. Open Questions

| # | Question | Default Assumption |
|---|----------|--------------------|
| 1 | Package or repository-local first? | Start repository-local and preserve packaging boundaries |
| 2 | What capabilities are needed beyond the initial vocabulary? | Add only for concrete adapter use cases |
| 3 | Should discovery inspect sources beyond version/help? | Start with version and help output |
| 4 | Which probes are safe? | Read-only and bounded by default; mutation requires opt-in |
| 5 | Where does registry data live? | OS user config/cache directory with override |
| 6 | How are prompts transported? | Adapter-selected safe transport; no shell interpolation |
| 7 | What do composition stages exchange? | Declared files plus metadata manifest |
| 8 | What is fallback ranking? | Verified full matches, then discovered full matches |
| 9 | Which CI platforms are required? | Linux, macOS, and Windows when packaging begins |
| 10 | Should third-party adapters load dynamically? | Built-in adapters first; defer dynamic loading |
| 11 | How are authentication failures classified? | Adapter execution/configuration failures with redacted actionable output |
| 12 | Is the registry shared? | Per-user and per-machine by default |
