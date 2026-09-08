import {
  createBuiltInHarnessAdapterRegistry,
  HarnessAdapterRegistry,
  UnsupportedOperationError,
  type ExecutionEnvironmentPolicy,
  type ExecutionResult,
  type ForkResult,
  type HarnessAdapter,
} from "../harness/index.ts";
import { COMMAND_SCHEMA_VERSION, serializeCommandJson } from "../output/json.ts";
import { redactSecrets } from "../discovery/probe.ts";

export type SessionCommandName = "resume" | "fork";
export type SessionCommandStatus = "success" | "execution-failure" | "unavailable";

export interface SessionCommandOptions {
  readonly command: SessionCommandName;
  readonly harnessId: string;
  readonly sessionId: string;
  readonly task?: string;
  readonly cwd?: string;
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly environmentPolicy?: ExecutionEnvironmentPolicy;
  readonly timeoutMs?: number;
  readonly maxOutputLength?: number;
  readonly signal?: AbortSignal;
  readonly adapters?: HarnessAdapterRegistry | readonly HarnessAdapter[];
}

export interface SessionCommandResult {
  readonly schemaVersion: typeof COMMAND_SCHEMA_VERSION;
  readonly command: SessionCommandName;
  readonly status: SessionCommandStatus;
  readonly harnessId: string;
  readonly sessionId: string;
  readonly task?: string;
  readonly execution: ExecutionResult | null;
  readonly fork?: ForkResult;
  readonly error?: string;
}

function toRegistry(
  adapters: HarnessAdapterRegistry | readonly HarnessAdapter[] | undefined,
): HarnessAdapterRegistry {
  if (adapters === undefined) return createBuiltInHarnessAdapterRegistry();
  if (adapters instanceof HarnessAdapterRegistry) return adapters;
  return new HarnessAdapterRegistry(adapters);
}

function unavailable(
  options: SessionCommandOptions,
  message: string,
): SessionCommandResult {
  return {
    schemaVersion: COMMAND_SCHEMA_VERSION,
    command: options.command,
    status: "unavailable",
    harnessId: options.harnessId,
    sessionId: options.sessionId,
    ...(options.task === undefined ? {} : { task: options.task }),
    execution: null,
    error: redactSecrets(message),
  };
}

export async function runSessionCommand(
  options: SessionCommandOptions,
): Promise<SessionCommandResult> {
  if (options.harnessId.trim().length === 0) throw new Error("--harness must not be empty");
  if (options.sessionId.trim().length === 0) throw new Error("--session must not be empty");
  if (options.task !== undefined && options.task.trim().length === 0) {
    throw new Error("task must not be empty when provided");
  }

  const adapter = toRegistry(options.adapters).get(options.harnessId);
  if (adapter === undefined) return unavailable(options, `Harness '${options.harnessId}' is not registered`);
  const operation = options.command;
  if (!adapter.supportedOperations[operation]) {
    return unavailable(options, `Harness '${options.harnessId}' does not support the '${operation}' operation`);
  }

  try {
    if (operation === "resume") {
      const execution = await adapter.resume({
        sessionId: options.sessionId,
        ...(options.task === undefined ? {} : { task: options.task }),
        ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
        ...(options.env === undefined ? {} : { env: options.env }),
        ...(options.environmentPolicy === undefined ? {} : { environmentPolicy: options.environmentPolicy }),
        ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
        ...(options.maxOutputLength === undefined ? {} : { maxOutputLength: options.maxOutputLength }),
        ...(options.signal === undefined ? {} : { signal: options.signal }),
      });
      return { ...unavailable(options, ""), status: execution.succeeded ? "success" : "execution-failure", execution, error: undefined };
    }

    const fork = await adapter.fork({
      sessionId: options.sessionId,
      ...(options.task === undefined ? {} : { task: options.task }),
      ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
      ...(options.env === undefined ? {} : { env: options.env }),
      ...(options.environmentPolicy === undefined ? {} : { environmentPolicy: options.environmentPolicy }),
      ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
      ...(options.maxOutputLength === undefined ? {} : { maxOutputLength: options.maxOutputLength }),
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    });
    return { ...unavailable(options, ""), status: "success", execution: null, fork, error: undefined };
  } catch (error: unknown) {
    if (error instanceof UnsupportedOperationError) return unavailable(options, error.message);
    return { ...unavailable(options, ""), status: "execution-failure", error: redactSecrets(error instanceof Error ? error.message : String(error)) };
  }
}

export const resume = (options: Omit<SessionCommandOptions, "command">) =>
  runSessionCommand({ ...options, command: "resume" });

export const fork = (options: Omit<SessionCommandOptions, "command">) =>
  runSessionCommand({ ...options, command: "fork" });

export function formatSessionJson(result: SessionCommandResult): string {
  return serializeCommandJson(result);
}

export function formatSessionHuman(result: SessionCommandResult): string {
  const lines = [`${result.command}: ${result.status}`, `harness: ${result.harnessId}`, `session: ${result.sessionId}`];
  if (result.fork !== undefined) lines.push(`forked-session: ${result.fork.sessionId}`);
  if (result.execution !== null) {
    lines.push(`execution: ${result.execution.status}`);
    if (result.execution.stdout) lines.push(result.execution.stdout.trimEnd());
    if (result.execution.error) lines.push(`error: ${result.execution.error}`);
  }
  if (result.error) lines.push(`error: ${result.error}`);
  return lines.join("\n");
}
