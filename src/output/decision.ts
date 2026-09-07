import {
  COMMAND_SCHEMA_VERSION,
  JsonContractError,
  parseCommandJson,
  type VersionedCommandPayload,
} from "./json.ts";

/** The stable schema version for `switchyard explain --json`. */
export const DECISION_SCHEMA_VERSION = COMMAND_SCHEMA_VERSION;

export type DecisionStatus = "success" | "no-match" | "invalid-input";

/**
 * Shared routing-decision envelope. The explain command adds candidate,
 * policy, and selection fields without changing this discriminator.
 */
export interface DecisionJsonEnvelope extends VersionedCommandPayload {
  readonly schemaVersion: typeof DECISION_SCHEMA_VERSION;
  readonly command: "explain";
  readonly status: DecisionStatus;
}

function isDecisionStatus(value: string): value is DecisionStatus {
  return value === "success" || value === "no-match" || value === "invalid-input";
}

/**
 * Validate the stable explain discriminator without pretending to validate
 * command-owned candidate and policy fields.
 */
export function parseDecisionJson(input: string): DecisionJsonEnvelope {
  const envelope = parseCommandJson(input);
  if (envelope.schemaVersion !== DECISION_SCHEMA_VERSION) {
    throw new JsonContractError(
      `Decision JSON schemaVersion must be ${DECISION_SCHEMA_VERSION}`,
    );
  }
  if (envelope.command !== "explain") {
    throw new JsonContractError("Decision JSON command must be 'explain'");
  }
  if (!isDecisionStatus(envelope.status)) {
    throw new JsonContractError(`Unsupported decision status '${envelope.status}'`);
  }
  return {
    schemaVersion: envelope.schemaVersion,
    command: envelope.command,
    status: envelope.status,
  };
}
