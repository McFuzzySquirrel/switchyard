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
import type { HarnessDiscoveryAdapter } from "./harness/discovery-adapter.ts";
import { redactSecrets } from "./discovery/probe.ts";
import { COMMAND_SCHEMA_VERSION } from "./commands/discover.ts";
import { serializeCommandJson } from "./output/json.ts";

export const CLI_EXIT_CODES = Object.freeze({
  success: 0,
  partial: 1,
  usage: 2,
  failure: 3,
  noMatch: 4,
});

export interface CliIo {
  readonly stdout?: (text: string) => void;
  readonly stderr?: (text: string) => void;
}

interface ParsedArguments {
  readonly command: "discover" | "capabilities" | "explain" | "help";
  readonly json: boolean;
  readonly refresh: boolean;
  readonly verified: boolean;
  readonly requires?: string;
  readonly preferredHarness?: string;
  readonly allowFallback: boolean;
  readonly registryPath?: string;
  readonly harnessId?: string;
  readonly staleAfterMs?: number;
  readonly executable?: string;
}

function usageError(message: string): Error {
  return new Error(`${message}\nUsage: switchyard <discover|capabilities|explain> [options]`);
}

function valueAfter(args: readonly string[], index: number, option: string): string {
  const value = args[index + 1];
  if (value === undefined || value.startsWith("--")) {
    throw usageError(`${option} requires a value`);
  }
  return value;
}

function parseArguments(args: readonly string[]): ParsedArguments {
  const command = args[0] ?? "help";
  if (command === "--help" || command === "-h" || command === "help") {
    return {
      command: "help",
      json: false,
      refresh: false,
      verified: false,
      allowFallback: false,
    };
  }
  if (command !== "discover" && command !== "capabilities" && command !== "explain") {
    throw usageError(`Unknown command '${command}'`);
  }

  let json = false;
  let refresh = false;
  let verified = false;
  let requires: string | undefined;
  let preferredHarness: string | undefined;
  let allowFallback = false;
  let registryPath: string | undefined;
  let harnessId: string | undefined;
  let staleAfterMs: number | undefined;
  let executable: string | undefined;

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
        if (command !== "explain") {
          throw usageError(`${argument} is only supported by the explain command`);
        }
        requires = valueAfter(args, index, "--requires");
        index += 1;
        break;
      case "--preferred-harness":
        if (command !== "explain") {
          throw usageError(`${argument} is only supported by the explain command`);
        }
        preferredHarness = valueAfter(args, index, "--preferred-harness");
        index += 1;
        break;
      case "--allow-fallback":
        if (command !== "explain") {
          throw usageError(`${argument} is only supported by the explain command`);
        }
        allowFallback = true;
        break;
      case "--registry":
        registryPath = valueAfter(args, index, "--registry");
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
          if (command !== "explain") {
            throw usageError(`${argument.split("=")[0]} is only supported by the explain command`);
          }
          requires = argument.slice("--requires=".length);
        } else if (argument.startsWith("--preferred-harness=")) {
          if (command !== "explain") {
            throw usageError(`${argument.split("=")[0]} is only supported by the explain command`);
          }
          preferredHarness = argument.slice("--preferred-harness=".length);
        } else {
          throw usageError(`Unknown option '${argument}'`);
        }
    }
  }

  return {
    command,
    json,
    refresh,
    verified,
    ...(requires === undefined ? {} : { requires }),
    ...(preferredHarness === undefined ? {} : { preferredHarness }),
    allowFallback,
    ...(registryPath === undefined ? {} : { registryPath }),
    ...(harnessId === undefined ? {} : { harnessId }),
    ...(staleAfterMs === undefined ? {} : { staleAfterMs }),
    ...(executable === undefined ? {} : { executable }),
  };
}

function printHelp(): string {
  return [
    "Usage: switchyard <discover|capabilities|explain> [options]",
    "",
    "Commands:",
    "  discover       inspect configured harnesses and update the local registry",
    "  capabilities   read normalized capabilities without launching a harness",
    "  explain        explain deterministic selection without launching a harness",
    "",
    "Options:",
    "  --refresh                 probe adapters instead of using a cached registry",
    "  --verified                show only verified capabilities (capabilities)",
    "  --requires <capabilities> required comma-separated capabilities (explain)",
    "  --preferred-harness <id>  prefer a qualifying harness (explain)",
    "  --allow-fallback          allow fallback when the preferred harness misses requirements",
    "  --registry <path>         override the local registry path",
    "  --harness-id <id>         refresh one adapter (discover)",
    "  --executable <path>       override the executable for discovery",
    "  --stale-after-ms <ms>     mark older cached profiles as stale",
    "  --json                    emit machine-readable JSON",
  ].join("\n");
}

function commandOptions(
  parsed: ParsedArguments,
): DiscoverCommandOptions | CapabilitiesCommandOptions | ExplainCommandOptions {
  if (parsed.command === "discover") {
    const options: DiscoverCommandOptions = {
      ...(parsed.registryPath === undefined ? {} : { registryPath: parsed.registryPath }),
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
      ...(parsed.verified ? { verified: true } : {}),
      ...(parsed.staleAfterMs === undefined ? {} : { staleAfterMs: parsed.staleAfterMs }),
    };
  }
  const requires = (parsed.requires ?? "").split(",").map((item) => item.trim());
  return {
    ...(parsed.registryPath === undefined ? {} : { registryPath: parsed.registryPath }),
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

function explainJsonRequested(args: readonly string[]): boolean {
  return args[0] === "explain" && args.includes("--json");
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
): Promise<number> {
  const writeStdout = io.stdout ?? ((text: string) => process.stdout.write(`${text}\n`));
  const writeStderr = io.stderr ?? ((text: string) => process.stderr.write(`${text}\n`));

  let parsed: ParsedArguments;
  try {
    parsed = parseArguments(args);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    if (explainJsonRequested(args)) {
      writeStdout(serializeCommandJson({
        schemaVersion: COMMAND_SCHEMA_VERSION,
        command: "explain",
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
    return CLI_EXIT_CODES.usage;
  }

  if (parsed.command === "help") {
    writeStdout(printHelp());
    return CLI_EXIT_CODES.success;
  }

  try {
    const options = commandOptions(parsed);
    // The optional adapter argument is intentionally test-only; production
    // commands use the explicit built-in registry in discover().
    const result = parsed.command === "discover"
      ? await discover({
          ...(options as DiscoverCommandOptions),
          ...(_adapters === undefined ? {} : { adapters: _adapters }),
        })
      : parsed.command === "capabilities"
        ? await capabilities(options as CapabilitiesCommandOptions)
        : await explain(options as ExplainCommandOptions);
    if (parsed.json) {
      writeStdout(parsed.command === "discover"
        ? formatDiscoverJson(result as Awaited<ReturnType<typeof discover>>)
        : parsed.command === "capabilities"
          ? formatCapabilitiesJson(result as Awaited<ReturnType<typeof capabilities>>)
          : formatExplainJson(result as Awaited<ReturnType<typeof explain>>));
    } else {
      writeStdout(parsed.command === "discover"
        ? formatDiscoverHuman(result as Awaited<ReturnType<typeof discover>>)
        : parsed.command === "capabilities"
          ? formatCapabilitiesHuman(result as Awaited<ReturnType<typeof capabilities>>)
          : formatExplainHuman(result as Awaited<ReturnType<typeof explain>>));
    }
    if (result.status === "partial") return CLI_EXIT_CODES.partial;
    if (result.status === "no-match") return CLI_EXIT_CODES.noMatch;
    return CLI_EXIT_CODES.success;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    if (error instanceof ExplainInputError) {
      const invalid = explainInvalidInput(error);
      if (parsed.json) {
        writeStdout(formatExplainJson(invalid));
      } else {
        writeStderr(formatExplainHuman(invalid));
      }
      return CLI_EXIT_CODES.usage;
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
