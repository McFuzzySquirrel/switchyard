# Adapter Conformance Checklist

> Load when: you need to validate a new adapter registration, supported-operation matrix, config precedence, or unsupported-operation behavior.

## Required conformance gates

1. The adapter implements the normalized vendor boundary without leaking matcher logic into the runtime.
2. Built-in adapters and stubs use the same capability vocabulary as the rest of the project.
3. Configuration precedence is deterministic: explicit CLI or env values override local config values, and invalid fields fail with actionable diagnostics.
4. Unsupported operations fail before process launch.
5. The adapter remains testable without a real vendor binary by using a fixture or stub adapter.

## Registration matrix

Track the following for each adapter:

- adapter name
- registry entrypoint
- supported operations
- unsupported operations
- required config fields
- override precedence
- normalized capability labels

## Validation patterns

Use a stub adapter that exercises:

- discovery success and failure
- verification success and failure
- execution success and fail-fast unsupported cases
- dry-run flows
- invalid config diagnostics

For each run, assert:

- the operation name matches the shared contract
- the adapter output shape is stable and parseable
- the diagnostics redact secret values or omit them from the public result
- no matcher rewrite is required for registration or execution

## Review standard

Any adapter that needs a custom matcher change is not conformant. The project contract should remain stable while the adapter implements the vendor-specific semantics behind the boundary.
