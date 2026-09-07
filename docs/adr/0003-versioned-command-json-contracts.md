# ADR-0003: Versioned command JSON contracts

- **Status:** Accepted
- **Date:** 2026-09-07

## Context

Switchyard commands are consumed both by people in plain terminals and by
scripts. The explain command also needs to make deterministic routing
decisions inspectable without requiring consumers to reproduce the matcher.
Command-local calls to `JSON.stringify` do not provide a shared compatibility
boundary and make it easy for a new command to omit its schema marker or
represent status differently.

## Decision

All public machine-readable command results use the shared serializer in
`src/output/json.ts`. A result has a positive integer `schemaVersion`, a
non-empty `command`, and a non-empty `status`. Command modules own the
remaining fields and preserve their existing field names.

The routing decision uses schema version 1 and the `explain` command
discriminator. Its status variants remain `success`, `no-match`, and
`invalid-input`; the CLI exit categories remain unchanged (`0`, `4`, and `2`
respectively). `parseCommandJson` validates the shared envelope and
`parseDecisionJson` additionally validates the explain discriminator and
status. Both leave command-specific candidate and policy validation to the
command contract.

New fields are additive and must have a backward-compatible default when
readers are expected to support older payloads. A schema-version bump is
required only for an incompatible rename, removal, or semantic change.
Human output remains a separate plain-text presentation of the same status and
decision information. No serializer or decision field may contain credentials
or other unredacted harness output.

Routing-policy additions follow the same rule: `policy.attempts` is an
additive, deterministic explanation field. It reports only policy candidates
that were checked (preferred first, then the selected qualifying fallback or
ranked candidate); it does not imply that a harness process was launched.

## Consequences

- Command output has one reusable compatibility boundary for CLI and library
  consumers.
- Existing schema-version-1 explain payloads and exit categories remain
  unchanged; scripts can continue to parse the existing keys.
- Feature owners can add command-specific payloads without importing another
  command implementation.
- Consumers still need command-specific validation after parsing the common
  envelope.

## Alternatives considered

- **Keep `JSON.stringify` in each command:** rejected because version and
  envelope behavior would drift between commands.
- **Use one global payload shape for every command:** rejected because it
  couples unrelated command domains and encourages meaningless fields.
- **Bump the explain schema for the shared serializer:** rejected because this
  is an additive compatibility boundary and does not change the explain
  payload semantics.
