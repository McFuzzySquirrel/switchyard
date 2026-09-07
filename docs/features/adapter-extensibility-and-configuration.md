# Feature: Adapter Extensibility and Configuration

## Traceability

| Feature ID | Original PRD ID | Description |
|-----------|----------------|-------------|
| ADPT-US-01 | US-09 | Add a harness adapter |
| ADPT-FR-01 | FR-25 | Define extensible adapter contract |
| ADPT-FR-02 | FR-26 | Configure harnesses and policies |
| ADPT-FR-03 | FR-28 | Document adapter development |

**Product Vision:** [docs/product-vision.md](../product-vision.md)  
**Original PRD:** [docs/PRD.md](../PRD.md)

## 1. Feature Overview

**Feature Name:** Adapter Extensibility and Configuration  
**ID Prefix:** ADPT  
**Summary:** Defines vendor-neutral adapter boundaries and user configuration for harnesses, executables, registry paths, and probe policy.  
**Dependencies:** Discovery and Registry  
**Priority:** Must

## 2. User Stories

| ID | As a... | I want to... | So that... | Priority |
|----|---------|-------------|-----------|----------|
| ADPT-US-01 | Team Maintainer | add a harness adapter | future tools do not require matcher changes | Must |

## 3. Functional Requirements

| ID | Requirement | Priority |
|----|-------------|----------|
| ADPT-FR-01 | Define an adapter contract that future harnesses can implement without matcher changes | Must |
| ADPT-FR-02 | Configure harnesses, executable overrides, probe policy, and registry location | Must |
| ADPT-FR-03 | Document how to add and test an adapter | Should |

## 4. UI / Interaction Design

Configuration uses a documented local file and environment overrides. Adapter diagnostics identify the adapter ID and supported operations without exposing secrets. Built-in adapters are registered explicitly.

## 5. Implementation Tasks

### Phase 1: Contract
- [ ] Define discovery, verification, execution, resume, and fork adapter interfaces.
- [x] Define capability observation and operation support schemas.
- [x] Add adapter conformance fixtures.

### Phase 2: Configuration
- [x] Define configuration file and environment overrides.
- [x] Implement harness executable overrides and registry location.
- [x] Document adapter registration and testing.

## 6. Testing Strategy

| Level | Scope | Approach |
|-------|-------|----------|
| Unit Tests | Contract validation and configuration parsing | Typed fixtures |
| Integration Tests | Stub adapter registration and invocation | Adapter conformance suite |
| Documentation Tests | Examples and schemas | Command examples and validation fixtures |

Key test scenarios:
1. Stub adapter registers without matcher changes.
2. Invalid configuration reports actionable field errors.
3. Executable override takes precedence over PATH.
4. Unsupported adapter operations are exposed accurately.

## 7. Acceptance Criteria

1. An adapter can implement discovery and execution through the documented contract.
2. Core routing has no vendor-specific conditionals.
3. Configuration supports executable overrides, registry location, and probe policy.
4. A stub adapter passes the conformance suite.
5. Adapter documentation includes lifecycle, errors, and security expectations.

## 8. Open Questions

| # | Question | Default Assumption |
|---|----------|--------------------|
| 1 | Should third-party adapters load dynamically? | Built-in adapters first; defer dynamic loading until trust boundaries are defined |
