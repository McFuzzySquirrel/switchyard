/**
 * Stable process exit categories exposed by the Switchyard CLI.
 *
 * Keep these numeric values compatible: shell scripts and CI use them without
 * necessarily parsing the command's JSON or human-readable output.
 */
export const CLI_EXIT_CODES = Object.freeze({
  success: 0,
  partial: 1,
  invalidInput: 2,
  /** @deprecated Use invalidInput for the public input-validation category. */
  usage: 2,
  failure: 3,
  noMatch: 4,
  unavailable: 5,
} as const);

export type CliExitCategory = keyof typeof CLI_EXIT_CODES;

export type CliCommandStatus =
  | "success"
  | "dry-run"
  | "partial"
  | "empty"
  | "invalid-input"
  | "no-match"
  | "unavailable"
  | "execution-failure"
  | "error";

/**
 * Maps a public command status to its stable shell exit category.
 *
 * Timeout and cancellation remain distinct in nested ExecutionResult data,
 * but are execution failures at the command boundary and intentionally share
 * the established `failure` exit code.
 */
export function exitCodeForStatus(status: CliCommandStatus): number {
  switch (status) {
    case "success":
    case "dry-run":
    case "empty":
      return CLI_EXIT_CODES.success;
    case "partial":
      return CLI_EXIT_CODES.partial;
    case "invalid-input":
      return CLI_EXIT_CODES.invalidInput;
    case "no-match":
      return CLI_EXIT_CODES.noMatch;
    case "unavailable":
      return CLI_EXIT_CODES.unavailable;
    case "execution-failure":
    case "error":
      return CLI_EXIT_CODES.failure;
  }
}
