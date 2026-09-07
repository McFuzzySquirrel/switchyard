# CLI Contract Checklist

> Load when: a command output or exit contract is being changed, a JSON schema is being added or evolved, or a redaction or no-color parity bug needs review.

## Compatibility review

Before changing a command, check:

- Is the contract additive or breaking?
- Does the change require a schema version bump or a backward-compatible default?
- Are old scripts or CI runners still expected to parse the output?
- Does the changed field appear in both human and JSON output with the same semantics?

## Stable output rules

Apply these rules to every public command result:

1. Keep the command payload stable and parseable.
2. Maintain no-color parity for human output.
3. Preserve the project’s exit-category vocabulary.
4. Avoid unredacted secret values in logs or structured output.
5. Treat compatibility as part of the public contract, not as an afterthought.

## Redaction and exit coverage

Validate the following cases for each command:

- success path
- nonzero execution failure
- unsupported operation
- timeout
- cancellation
- secret-bearing stderr or stdout

A contract is complete only when the same underlying status is represented consistently in both the terminal text and the JSON payload.

## Release sign-off

Before merging the change, confirm:

- changed fields have a clear compatibility story
- tests cover both scriptable output and plain-terminal output
- redaction checks are explicit and repeatable
- the schema remains readable by existing automation if compatibility is required
