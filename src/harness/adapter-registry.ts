import type { HarnessAdapter } from "./adapter.ts";
import {
  createGitHubCopilotAdapter,
  type GitHubCopilotAdapterOptions,
} from "./copilot.ts";
import {
  createOpenCodeAdapter,
  type OpenCodeAdapterOptions,
} from "./opencode.ts";

/**
 * Explicit in-memory registration for the full, execute-capable
 * `HarnessAdapter` contract. Third-party adapters are not dynamically
 * loaded in this release (see ADR-0002); every adapter — built-in or a
 * conformance stub — is registered here explicitly by the process that
 * assembles the runtime, and registration never requires matcher changes.
 */
export class HarnessAdapterRegistry {
  readonly #adapters = new Map<string, HarnessAdapter>();

  constructor(adapters: readonly HarnessAdapter[] = []) {
    for (const adapter of adapters) {
      this.register(adapter);
    }
  }

  register(adapter: HarnessAdapter): void {
    if (this.#adapters.has(adapter.id)) {
      throw new Error(`Harness adapter '${adapter.id}' is already registered`);
    }
    this.#adapters.set(adapter.id, adapter);
  }

  get(id: string): HarnessAdapter | undefined {
    return this.#adapters.get(id);
  }

  list(): readonly HarnessAdapter[] {
    return [...this.#adapters.values()];
  }
}

/** Per-harness resolved runtime configuration used to build built-in adapters. */
export interface BuiltInHarnessAdapterOptions {
  readonly opencode?: OpenCodeAdapterOptions;
  readonly copilot?: GitHubCopilotAdapterOptions;
}

/**
 * Builds the explicit list of built-in `HarnessAdapter` instances. Each
 * adapter is constructed with its own resolved configuration so an
 * executable override supplied here consistently reaches discovery,
 * verification, execution, resume, and fork on that instance.
 */
export function createBuiltInHarnessAdapters(
  options: BuiltInHarnessAdapterOptions = {},
): readonly HarnessAdapter[] {
  return Object.freeze([
    createOpenCodeAdapter(options.opencode ?? {}),
    createGitHubCopilotAdapter(options.copilot ?? {}),
  ]);
}

/** Creates a registry pre-populated with the explicit built-in adapters. */
export function createBuiltInHarnessAdapterRegistry(
  options: BuiltInHarnessAdapterOptions = {},
): HarnessAdapterRegistry {
  return new HarnessAdapterRegistry(createBuiltInHarnessAdapters(options));
}
