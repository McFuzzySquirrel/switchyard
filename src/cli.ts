#!/usr/bin/env node

import { fileURLToPath } from "node:url";
import {
  capabilities,
  formatCapabilitiesJson,
  formatCapabilitiesHuman,
  type CapabilitiesCommandOptions,
} from "./commands/capabilities.ts";
import {
  discover,
  formatDiscoverJson,
  formatDiscoverHuman,
  type DiscoverCommandOptions,
} from "./commands/discover.ts";
import {
  explain,
  explainInvalidInput,
  formatExplainJson,
  formatExplainHuman,
  ExplainInputError,
  type ExplainCommandOptions,
} from "./commands/explain.ts";
import {
  run,
  runInvalidInput,
  formatRunJson,
  formatRunHuman,
  RunInputError,
  type RunCommandOptions,
} from "./commands/run.ts";
import {
  prompt,
  PromptSelectionError,
  type PromptSelectionIo,
} from "./commands/prompt.ts";
import {
  verify,
  formatVerifyJson,
  formatVerifyHuman,
  type VerifyCommandOptions,
} from "./commands/verify.ts";
import {
  compose,
  composeInvalidInput,
  formatComposeJson,
  formatComposeHuman,
  ComposeInputError,
  type ComposeCommandOptions,
} from "./commands/compose.ts";
import type { HarnessDiscoveryAdapter } from "./harness/discovery-adapter.ts";
import type { HarnessAdapter, HarnessAdapterRegistry } from "./harness/index.ts";
import { normalizeCapabilityName, type CapabilityName } from "./capabilities/vocabulary.ts";
import type { ProbeRisk } from "./verification/policy.ts";
import { redactSecrets } from "./discovery/probe.ts";
import { COMMAND_SCHEMA_VERSION } from "./commands/discover.ts";
import { serializeCommandJson } from "./output/json.ts";
import { CLI_EXIT_CODES, exitCodeForStatus } from "./output/exit-codes.ts";

export { CLI_EXIT_CODES, exitCodeForStatus } from "./output/exit-codes.ts";

export interface CliIo {
  readonly stdout?: (text: string) => void;
  readonly stderr?: (text: string) => void;
  readonly stdin?: NodeJS.ReadableStream;
  readonly interactive?: boolean;
}

interface ParsedArguments {
  readonly command: "discover" | "capabilities" | "explain" | "run" | "prompt" | "verify" | "compose" | "help";
  readonly json: boolean;
  readonly refresh: boolean;
  readonly verified: boolean;
  readonly requires?: string;
  readonly preferredHarness?: string;
  readonly workflowPath?: string;
  readonly allowFallback: boolean;
  readonly registryPath?: string;
  readonly configPath?: string;
  readonly harnessId?: string;
  readonly staleAfterMs?: number;
  readonly executable?: string;
  readonly task?: string;
  readonly cwd?: string;
  readonly timeoutMs?: number;
  readonly dryRun: boolean;
  readonly capabilities?: readonly string[];
  readonly risks?: readonly ProbeRisk[];
  readonly allowMutatingProbes: boolean;
  readonly allowExternalAccess: boolean;
  readonly allowPaidProbes: boolean;
  readonly allowModelInvocation: boolean;
}

function usageError(message: string): Error {
  return new Error(`${message}\nUsage: switchyard <discover|capabilities|explain|run|prompt|verify|compose> [options]`);
}

function valueAfter(args: readonly string[], index: number, option: string): string {
  const value = args[index + 1];
  if (value === undefined || value.startsWith("--")) {
    throw usageError(`${option} requires a value`);
  }
  return value;
}

function parseArguments(args: readonly string[]): ParsedArguments {
  const requestedCommand = args[0] ?? "help";
  if (requestedCommand === "--help" || requestedCommand === "-h" || requestedCommand === "help") {
    return {
      command: "help",
      json: false,
      refresh: false,
      verified: false,
      allowFallback: false,
      dryRun: false,
      allowMutatingProbes: false,
      allowExternalAccess: false,
      allowPaidProbes: false,
      allowModelInvocation: false,
    };
  }
  const command = requestedCommand;
  if (
    command !== "discover" &&
    command !== "capabilities" &&
    command !== "explain" &&
    command !== "run" &&
    command !== "prompt" &&
    command !== "verify" &&
    command !== "compose"
  ) {
    throw usageError(`Unknown command '${command}'`);
  }

  let json = false;
  let refresh = false;
  let verified = false;
  let requires: string | undefined;
  let preferredHarness: string | undefined;
  let allowFallback = false;
  let dryRun = false;
  let cwd: string | undefined;
  let timeoutMs: number | undefined;
  const taskParts: string[] = [];
  let workflowPath: string | undefined;
  let registryPath: string | undefined;
  let configPath: string | undefined;
  let harnessId: string | undefined;
  let staleAfterMs: number | undefined;
  let executable: string | undefined;
  let capabilities: string[] = [];
  let risks: ProbeRisk[] = [];
  let allowMutatingProbes = false;
  let allowExternalAccess = false;
  let allowPaidProbes = false;
  let allowModelInvocation = false;

  for (let index = 1; index < args.length; index += 1) {
    const argument = args[index];
    switch (argument) {
      case "--json":
        json = true;
        break;
      case "--refresh":
        refresh = true;
        break;
      case "--verified":
        verified = true;
        break;
      case "--requires":
        if (command !== "explain" && command !== "run" && command !== "prompt") {
          throw usageError(`${argument} is only supported by the explain and run commands`);
        }
        requires = valueAfter(args, index, "--requires");
        index += 1;
        break;
      case "--capability":
        if (command !== "verify") {
          throw usageError(`${argument} is only supported by the verify command`);
        }
        capabilities.push(valueAfter(args, index, "--capability"));
        index += 1;
        break;
      case "--preferred-harness":
        if (command !== "explain" && command !== "run" && command !== "prompt") {
          throw usageError(`${argument} is only supported by the explain and run commands`);
        }
        preferredHarness = valueAfter(args, index, "--preferred-harness");
        index += 1;
        break;
      case "--allow-fallback":
        if (command !== "explain" && command !== "run" && command !== "prompt") {
          throw usageError(`${argument} is only supported by the explain and run commands`);
        }
        allowFallback = true;
        break;
      case "--dry-run":
        if (command !== "run" && command !== "prompt") {
          throw usageError(`${argument} is only supported by the run command`);
        }
        dryRun = true;
        break;
      case "--harness":
        if (command !== "verify") {
          throw usageError(`${argument} is only supported by the verify command`);
        }
        harnessId = valueAfter(args, index, "--harness");
        index += 1;
        break;
      case "--risk": {
        if (command !== "verify") {
          throw usageError(`${argument} is only supported by the verify command`);
        }
        const value = valueAfter(args, index, "--risk") as ProbeRisk;
        if (!["read-only", "mutating", "external-access", "paid", "model-invoking"].includes(value)) {
          throw usageError("--risk must be read-only, mutating, external-access, paid, or model-invoking");
        }
        risks.push(value);
        index += 1;
        break;
      }
      case "--allow-mutating-probes":
        if (command !== "verify") throw usageError(`${argument} is only supported by the verify command`);
        allowMutatingProbes = true;
        break;
      case "--allow-external-access":
        if (command !== "verify") throw usageError(`${argument} is only supported by the verify command`);
        allowExternalAccess = true;
        break;
      case "--allow-paid-probes":
        if (command !== "verify") throw usageError(`${argument} is only supported by the verify command`);
        allowPaidProbes = true;
        break;
      case "--allow-model-invocation":
        if (command !== "verify") throw usageError(`${argument} is only supported by the verify command`);
        allowModelInvocation = true;
        break;
      case "--cwd":
        if (command !== "run" && command !== "prompt") {
          throw usageError(`${argument} is only supported by the run command`);
        }
        cwd = valueAfter(args, index, "--cwd");
        index += 1;
        break;
      case "--timeout-ms": {
        if (command !== "run" && command !== "prompt") {
          throw usageError(`${argument} is only supported by the run command`);
        }
        const value = valueAfter(args, index, "--timeout-ms");
        timeoutMs = Number(value);
        if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
          throw usageError("--timeout-ms must be a finite positive number");
        }
        index += 1;
        break;
      }
      case "--registry":
        registryPath = valueAfter(args, index, "--registry");
        index += 1;
        break;
      case "--config":
        configPath = valueAfter(args, index, "--config");
        index += 1;
        break;
      case "--harness-id":
        harnessId = valueAfter(args, index, "--harness-id");
        index += 1;
        break;
      case "--stale-after-ms": {
        const value = valueAfter(args, index, "--stale-after-ms");
        staleAfterMs = Number(value);
        if (!Number.isFinite(staleAfterMs) || staleAfterMs < 0) {
          throw usageError("--stale-after-ms must be a finite non-negative number");
        }
        index += 1;
        break;
      }
      case "--executable":
        executable = valueAfter(args, index, "--executable");
        index += 1;
        break;
      default:
        if (argument.startsWith("--requires=")) {
          if (command !== "explain" && command !== "run" && command !== "prompt") {
            throw usageError(
              `${argument.split("=")[0]} is only supported by the explain and run commands`,
            );
          }
          requires = argument.slice("--requires=".length);
        } else if (argument.startsWith("--capability=")) {
          if (command !== "verify") {
            throw usageError("--capability is only supported by the verify command");
          }
          capabilities.push(argument.slice("--capability=".length));
        } else if (argument.startsWith("--harness=")) {
          if (command !== "verify") {
            throw usageError("--harness is only supported by the verify command");
          }
          harnessId = argument.slice("--harness=".length);
        } else if (argument.startsWith("--risk=")) {
          if (command !== "verify") {
            throw usageError("--risk is only supported by the verify command");
          }
          const value = argument.slice("--risk=".length) as ProbeRisk;
          if (!["read-only", "mutating", "external-access", "paid", "model-invoking"].includes(value)) {
            throw usageError("--risk must be read-only, mutating, external-access, paid, or model-invoking");
          }
          risks.push(value);
        } else if (argument.startsWith("--preferred-harness=")) {
          if (command !== "explain" && command !== "run" && command !== "prompt") {
            throw usageError(
              `${argument.split("=")[0]} is only supported by the explain and run commands`,
            );
          }
          preferredHarness = argument.slice("--preferred-harness=".length);
        } else if (argument.startsWith("--")) {
          throw usageError(`Unknown option '${argument}'`);
        } else if (command === "run" || command === "prompt") {
          taskParts.push(argument);
        } else if (command === "compose") {
          if (workflowPath !== undefined) {
            throw usageError("compose accepts exactly one workflow file argument");
          }
          workflowPath = argument;
        } else {
          throw usageError(`Unexpected argument '${argument}'`);
        }
    }
  }

  return {
    command,
    json,
    refresh,
    verified,
    dryRun,
    ...(cwd === undefined ? {} : { cwd }),
    ...(timeoutMs === undefined ? {} : { timeoutMs }),
    ...(taskParts.length === 0 ? {} : { task: taskParts.join(" ") }),
    ...(workflowPath === undefined ? {} : { workflowPath }),
    ...(requires === undefined ? {} : { requires }),
    ...(preferredHarness === undefined ? {} : { preferredHarness }),
    allowFallback,
    ...(registryPath === undefined ? {} : { registryPath }),
    ...(configPath === undefined ? {} : { configPath }),
    ...(harnessId === undefined ? {} : { harnessId }),
    ...(staleAfterMs === undefined ? {} : { staleAfterMs }),
    ...(executable === undefined ? {} : { executable }),
    ...(capabilities.length === 0 ? {} : { capabilities }),
    ...(risks.length === 0 ? {} : { risks }),
    allowMutatingProbes,
    allowExternalAccess,
    allowPaidProbes,
    allowModelInvocation,
  };
}

function printHelp(): string {
  return [
    "Usage: switchyard <discover|capabilities|explain|run|prompt|verify|compose> [options]",
    "",
    "Commands:",
    "  discover       inspect configured harnesses and update the local registry",
    "  capabilities   read normalized capabilities without launching a harness",
    "  explain        explain deterministic selection without launching a harness",
    "  run            route a task and execute it through the selected harness",
    "  prompt         route and execute a prompt (alias for run)",
    "  verify         run bounded capability probes and record verification state",
    "  compose        run a declared multi-stage workflow across selected adapters",
    "",
    "Options:",
    "  --refresh                 probe adapters instead of using a cached registry",
    "  --verified                show only verified capabilities (capabilities)",
    "  --requires <capabilities> required comma-separated capabilities (explain, run, prompt)",
    "  --preferred-harness <id>  prefer a qualifying harness (explain, run, prompt)",
    "  --allow-fallback          allow fallback when the preferred harness misses requirements",
    "  --dry-run                 describe the selection without launching the task (run, prompt)",
    "  --cwd <path>              controlled working directory for execution (run, prompt)",
    "  --timeout-ms <ms>         execution timeout in milliseconds (run, prompt)",
    "  --registry <path>         override the local registry path",
    "  --config <path>           read local configuration from this file",
    "  --harness-id <id>         refresh one adapter (discover)",
    "  --executable <path>       override the executable for discovery",
    "  --harness <id>            verify one harness (verify)",
    "  --capability <name>       verify one capability (verify; repeatable)",
    "  --risk <class>            declare probe risk (verify; repeatable)",
    "  --allow-mutating-probes   approve probes that may mutate state",
    "  --allow-external-access   approve probes that access external services",
    "  --allow-paid-probes       approve probes that may incur provider charges",
    "  --allow-model-invocation  approve probes that invoke a model",
    "  --stale-after-ms <ms>     mark older cached profiles as stale",
    "  --json                    emit machine-readable JSON",
    "",
    "run also accepts a positional task string, for example:",
    '  switchyard run --requires=headless "fix the failing test"',
    "prompt is a task-focused alias, for example:",
    '  switchyard prompt --requires=headless "fix the failing test"',
    "",
    "compose accepts a positional workflow file path, for example:",
    "  switchyard compose ./workflow.json --json",
  ].join("\n");
}

function commandOptions(
  parsed: ParsedArguments,
): DiscoverCommandOptions | CapabilitiesCommandOptions | ExplainCommandOptions | RunCommandOptions | VerifyCommandOptions | ComposeCommandOptions {
  if (parsed.command === "discover") {
    const options: DiscoverCommandOptions = {
      ...(parsed.registryPath === undefined ? {} : { registryPath: parsed.registryPath }),
      ...(parsed.configPath === undefined ? {} : { configPath: parsed.configPath }),
      ...(parsed.refresh ? { refresh: true } : {}),
      ...(parsed.harnessId === undefined ? {} : { harnessId: parsed.harnessId }),
      ...(parsed.staleAfterMs === undefined ? {} : { staleAfterMs: parsed.staleAfterMs }),
      ...(parsed.executable === undefined ? {} : { executable: parsed.executable }),
    };
    return options;
  }
  if (parsed.command === "capabilities") {
    return {
      ...(parsed.registryPath === undefined ? {} : { registryPath: parsed.registryPath }),
      ...(parsed.configPath === undefined ? {} : { configPath: parsed.configPath }),
      ...(parsed.verified ? { verified: true } : {}),
      ...(parsed.staleAfterMs === undefined ? {} : { staleAfterMs: parsed.staleAfterMs }),
    };
  }
  const requires = parsed.requires === undefined
    ? []
    : parsed.requires.split(",").map((item) => item.trim());
  if (parsed.command === "run" || parsed.command === "prompt") {
    const options: RunCommandOptions = {
      ...(parsed.registryPath === undefined ? {} : { registryPath: parsed.registryPath }),
      ...(parsed.configPath === undefined ? {} : { configPath: parsed.configPath }),
      requirements: {
        schemaVersion: 1,
        requires,
        ...(parsed.preferredHarness === undefined
          ? {}
          : { preferredHarness: parsed.preferredHarness }),
        ...(parsed.allowFallback ? { allowFallback: true } : {}),
      },
      task: parsed.task ?? "",
      ...(parsed.cwd === undefined ? {} : { cwd: parsed.cwd }),
      ...(parsed.timeoutMs === undefined ? {} : { timeoutMs: parsed.timeoutMs }),
      dryRun: parsed.dryRun,
      ...(parsed.staleAfterMs === undefined ? {} : { staleAfterMs: parsed.staleAfterMs }),
    };
    return options;
  }
  if (parsed.command === "verify") {
    const normalizedCapabilities: CapabilityName[] = [];
    for (const capability of parsed.capabilities ?? []) {
      const normalized = normalizeCapabilityName(capability);
      if (normalized === undefined) {
        throw usageError(`Unknown capability '${capability}'`);
      }
      normalizedCapabilities.push(normalized);
    }
    return {
      ...(parsed.registryPath === undefined ? {} : { registryPath: parsed.registryPath }),
      ...(parsed.configPath === undefined ? {} : { configPath: parsed.configPath }),
      ...(parsed.harnessId === undefined ? {} : { harnessId: parsed.harnessId }),
      ...(normalizedCapabilities.length === 0 ? {} : { capabilities: normalizedCapabilities }),
      ...(parsed.risks === undefined ? {} : { risks: parsed.risks }),
      policy: {
        ...(parsed.allowMutatingProbes ? { allowMutatingProbes: true } : {}),
        ...(parsed.allowExternalAccess ? { allowExternalAccess: true } : {}),
        ...(parsed.allowPaidProbes ? { allowPaidProbes: true } : {}),
        ...(parsed.allowModelInvocation ? { allowModelInvocation: true } : {}),
      },
    };
  }
  if (parsed.command === "compose") {
    const options: ComposeCommandOptions = {
      ...(parsed.registryPath === undefined ? {} : { registryPath: parsed.registryPath }),
      ...(parsed.configPath === undefined ? {} : { configPath: parsed.configPath }),
      ...(parsed.workflowPath === undefined ? {} : { workflowPath: parsed.workflowPath }),
      ...(parsed.staleAfterMs === undefined ? {} : { staleAfterMs: parsed.staleAfterMs }),
    };
    return options;
  }
  return {
    ...(parsed.registryPath === undefined ? {} : { registryPath: parsed.registryPath }),
    ...(parsed.configPath === undefined ? {} : { configPath: parsed.configPath }),
    requirements: {
      schemaVersion: 1,
      requires,
      ...(parsed.preferredHarness === undefined
        ? {}
        : { preferredHarness: parsed.preferredHarness }),
      ...(parsed.allowFallback ? { allowFallback: true } : {}),
    },
    ...(parsed.staleAfterMs === undefined ? {} : { staleAfterMs: parsed.staleAfterMs }),
  };
}

function jsonInvalidInputCommand(
  args: readonly string[],
): "explain" | "run" | "prompt" | "verify" | "compose" | undefined {
  const command = args[0];
  if (
    (command === "explain" || command === "run" || command === "prompt" || command === "verify" || command === "compose") &&
    args.includes("--json")
  ) {
    return command;
  }
  return undefined;
}

/**
 * Runs the CLI without terminating the hosting process. This makes the
 * command contract testable while the executable entry point still returns
 * conventional exit categories for shell callers.
 */
export async function runCli(
  args: readonly string[] = process.argv.slice(2),
  io: CliIo = {},
  _adapters?: readonly HarnessDiscoveryAdapter[],
  _executionAdapters?: HarnessAdapterRegistry | readonly HarnessAdapter[],
): Promise<number> {
  const writeStdout = io.stdout ?? ((text: string) => process.stdout.write(`${text}\n`));
  const writeStderr = io.stderr ?? ((text: string) => process.stderr.write(`${text}\n`));

  let parsed: ParsedArguments;
  try {
    parsed = parseArguments(args);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    const jsonCommand = jsonInvalidInputCommand(args);
    if (jsonCommand !== undefined) {
      writeStdout(serializeCommandJson({
        schemaVersion: COMMAND_SCHEMA_VERSION,
        command: jsonCommand,
        status: "invalid-input",
        error: {
          code: "invalid-input",
          message: redactSecrets(message),
          issues: [],
        },
      }));
    } else {
      writeStderr(message);
    }
    return CLI_EXIT_CODES.invalidInput;
  }

  if (parsed.command === "help") {
    writeStdout(printHelp());
    return CLI_EXIT_CODES.success;
  }

  try {
    const promptCommand = parsed.command === "prompt";
    const command = promptCommand ? { ...parsed, command: "run" as const } : parsed;
    const options = commandOptions(command);
    const interactive = io.interactive ?? (
      process.stdin.isTTY === true && process.stdout.isTTY === true
    );
    if (promptCommand && parsed.requires === undefined && (!interactive || parsed.json)) {
      throw new PromptSelectionError(
        "Interactive capability selection requires a terminal; provide --requires for scripted or JSON use.",
      );
    }
    // The optional adapter argument is intentionally test-only; production
    // commands use the explicit built-in registry in discover().
    const result = command.command === "discover"
      ? await discover({
          ...(options as DiscoverCommandOptions),
          ...(_adapters === undefined ? {} : { adapters: _adapters }),
        })
      : command.command === "capabilities"
        ? await capabilities(options as CapabilitiesCommandOptions)
        : command.command === "run"
          ? promptCommand
            ? await prompt({
                ...(options as RunCommandOptions),
                discoveryAdapters: _adapters,
                ...(_executionAdapters === undefined ? {} : { adapters: _executionAdapters }),
              }, parsed.requires === undefined
                ? ({
                    input: io.stdin ?? process.stdin,
                    write: writeStdout,
                  } satisfies PromptSelectionIo)
                : undefined)
            : await run({
                ...(options as RunCommandOptions),
                ...(_executionAdapters === undefined ? {} : { adapters: _executionAdapters }),
              })
          : command.command === "verify"
            ? await verify({
                ...(options as VerifyCommandOptions),
                ...(_executionAdapters === undefined ? {} : { adapters: _executionAdapters }),
              })
            : parsed.command === "compose"
              ? await compose({
                  ...(options as ComposeCommandOptions),
                  ...(_executionAdapters === undefined ? {} : { adapters: _executionAdapters }),
                })
              : await explain(options as ExplainCommandOptions);
    if (parsed.json) {
      writeStdout(command.command === "discover"
        ? formatDiscoverJson(result as Awaited<ReturnType<typeof discover>>)
        : command.command === "capabilities"
          ? formatCapabilitiesJson(result as Awaited<ReturnType<typeof capabilities>>)
          : command.command === "run"
            ? formatRunJson(result as Awaited<ReturnType<typeof run>>)
            : command.command === "verify"
              ? formatVerifyJson(result as Awaited<ReturnType<typeof verify>>)
              : parsed.command === "compose"
                ? formatComposeJson(result as Awaited<ReturnType<typeof compose>>)
                : formatExplainJson(result as Awaited<ReturnType<typeof explain>>));
    } else {
      writeStdout(command.command === "discover"
        ? formatDiscoverHuman(result as Awaited<ReturnType<typeof discover>>)
        : command.command === "capabilities"
          ? formatCapabilitiesHuman(result as Awaited<ReturnType<typeof capabilities>>)
          : command.command === "run"
            ? formatRunHuman(result as Awaited<ReturnType<typeof run>>)
              : parsed.command === "verify"
                ? formatVerifyHuman(result as Awaited<ReturnType<typeof verify>>)
                : parsed.command === "compose"
                  ? formatComposeHuman(result as Awaited<ReturnType<typeof compose>>)
                  : formatExplainHuman(result as Awaited<ReturnType<typeof explain>>));
    }
    return exitCodeForStatus(result.status);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    if (error instanceof RunInputError) {
      const invalid = runInvalidInput(error);
      if (parsed.json) {
        writeStdout(formatRunJson(invalid));
      } else {
        writeStderr(formatRunHuman(invalid));
      }
      return CLI_EXIT_CODES.invalidInput;
    }
    if (error instanceof ComposeInputError) {
      const invalid = composeInvalidInput(error);
      if (parsed.json) {
        writeStdout(formatComposeJson(invalid));
      } else {
        writeStderr(formatComposeHuman(invalid));
      }
      return CLI_EXIT_CODES.invalidInput;
    }
    if (error instanceof ExplainInputError) {
      const invalid = explainInvalidInput(error);
      if (parsed.json) {
        writeStdout(formatExplainJson(invalid));
      } else {
        writeStderr(formatExplainHuman(invalid));
      }
      return CLI_EXIT_CODES.invalidInput;
    }
    if (error instanceof PromptSelectionError) {
      if (parsed.json) {
        writeStdout(serializeCommandJson({
          schemaVersion: COMMAND_SCHEMA_VERSION,
          command: "run",
          status: "invalid-input",
          error: {
            code: "invalid-input",
            message: redactSecrets(error.message),
            issues: [],
          },
        }));
      } else {
        writeStderr(`prompt failed: ${redactSecrets(error.message)}`);
      }
      return CLI_EXIT_CODES.invalidInput;
    }
    if (parsed.json) {
      writeStdout(serializeCommandJson({
        schemaVersion: COMMAND_SCHEMA_VERSION,
        command: parsed.command,
        status: "error",
        error: {
          code: "command-failed",
          message: redactSecrets(message),
        },
      }));
    } else {
      writeStderr(`${parsed.command} failed: ${redactSecrets(message)}`);
    }
    return CLI_EXIT_CODES.failure;
  }
}

const invokedPath = process.argv[1];
if (invokedPath !== undefined &&
    fileURLToPath(import.meta.url) === invokedPath) {
  process.exitCode = await runCli();
}
