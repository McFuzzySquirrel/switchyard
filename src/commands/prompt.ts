import { createInterface } from "node:readline";
import {
  CAPABILITY_NAMES,
  type CapabilityName,
} from "../capabilities/vocabulary.ts";
import type { HarnessDiscoveryAdapter, HarnessAdapter } from "../harness/index.ts";
import {
  capabilities,
  type CapabilitiesCommandResult,
} from "./capabilities.ts";
import {
  discover,
  type DiscoverCommandOptions,
} from "./discover.ts";
import {
  run,
  type RunCommandOptions,
  type RunCommandResult,
} from "./run.ts";

const CAPABILITY_DESCRIPTIONS: Readonly<Record<CapabilityName, string>> = {
  headless: "non-interactive prompt execution",
  "model-selection": "choosing a provider or model",
  continue: "continuing an existing session",
  fork: "forking an existing session",
  mcp: "Model Context Protocol support",
  "repository-access": "working with repository files",
  "github-context": "GitHub issues, pull requests, or repository context",
  "parallel-execution": "parallel task execution",
  "local-models": "local model providers",
};

export interface PromptSelectionIo {
  readonly input: NodeJS.ReadableStream;
  readonly write: (text: string) => void;
}

export class PromptSelectionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PromptSelectionError";
  }
}

export function aggregateSelectableCapabilities(
  result: CapabilitiesCommandResult,
): readonly CapabilityName[] {
  const observed = new Set(
    result.harnesses.flatMap((profile) =>
      profile.capabilities
        .filter((observation) => observation.discovery.status === "observed")
        .map((observation) => observation.capability)),
  );
  return CAPABILITY_NAMES.filter((capability) => observed.has(capability));
}

async function readSelection(
  io: PromptSelectionIo,
): Promise<string> {
  const reader = createInterface({ input: io.input });
  try {
    const iterator = reader[Symbol.asyncIterator]();
    const next = await iterator.next();
    return next.done ? "" : String(next.value);
  } finally {
    reader.close();
  }
}

export async function selectCapabilities(
  available: readonly CapabilityName[],
  io: PromptSelectionIo,
): Promise<readonly CapabilityName[]> {
  if (available.length === 0) {
    throw new PromptSelectionError(
      "No discovered capabilities are available. Run discover --refresh and try again.",
    );
  }

  io.write("Select the capabilities this prompt needs:\n");
  available.forEach((capability, index) => {
    io.write(
      `[ ] ${index + 1}. ${capability} - ${CAPABILITY_DESCRIPTIONS[capability]}\n`,
    );
  });
  io.write("Enter one or more numbers separated by commas: ");

  const raw = (await readSelection(io)).trim();
  if (raw.length === 0) {
    throw new PromptSelectionError("Select at least one capability.");
  }

  const selectedIndexes = raw.split(",").map((value) => Number(value.trim()));
  if (
    selectedIndexes.some((index) =>
      !Number.isInteger(index) || index < 1 || index > available.length)
  ) {
    throw new PromptSelectionError(
      `Choose capability numbers from 1 to ${available.length}.`,
    );
  }

  const selected = [...new Set(selectedIndexes)].map((index) => available[index - 1]);
  return selected;
}

export interface PromptCommandOptions extends RunCommandOptions {
  readonly discoveryAdapters?: readonly HarnessDiscoveryAdapter[];
  readonly refreshIfNeeded?: boolean;
}

export async function loadCapabilitiesForPrompt(
  options: PromptCommandOptions,
): Promise<readonly CapabilityName[]> {
  let current = await capabilities({
    registryPath: options.registryPath,
    configPath: options.configPath,
    staleAfterMs: options.staleAfterMs,
  });

  if (
    options.refreshIfNeeded !== false &&
    (current.status === "empty" || current.stale.length > 0)
  ) {
    const discoveryOptions: DiscoverCommandOptions = {
      registryPath: options.registryPath,
      configPath: options.configPath,
      adapters: options.discoveryAdapters,
      refresh: true,
      staleAfterMs: options.staleAfterMs,
    };
    await discover(discoveryOptions);
    current = await capabilities({
      registryPath: options.registryPath,
      configPath: options.configPath,
      staleAfterMs: options.staleAfterMs,
    });
  }

  return aggregateSelectableCapabilities(current);
}

export async function prompt(
  options: PromptCommandOptions,
  io?: PromptSelectionIo,
): Promise<RunCommandResult> {
  const requirements = options.requirements as { readonly requires?: unknown } | undefined;
  const hasExplicitRequirements = Array.isArray(requirements?.requires) &&
    requirements.requires.length > 0;
  if (hasExplicitRequirements || io === undefined) {
    return run(options);
  }

  const available = await loadCapabilitiesForPrompt(options);
  const selected = await selectCapabilities(available, io);
  return run({
    ...options,
    requirements: {
      schemaVersion: 1,
      requires: selected,
    },
  });
}
