import {
  HarnessDiscoveryAdapterRegistry,
  type HarnessDiscoveryAdapter,
} from "./discovery-adapter.ts";
import { githubCopilotDiscoveryAdapter } from "./copilot.ts";
import { openCodeDiscoveryAdapter } from "./opencode.ts";

/** Built-ins are registered explicitly; third-party dynamic loading is unsupported. */
export const BUILT_IN_DISCOVERY_ADAPTERS: readonly HarnessDiscoveryAdapter[] =
  Object.freeze([openCodeDiscoveryAdapter, githubCopilotDiscoveryAdapter]);

export function createBuiltInDiscoveryAdapterRegistry(): HarnessDiscoveryAdapterRegistry {
  return new HarnessDiscoveryAdapterRegistry(BUILT_IN_DISCOVERY_ADAPTERS);
}

export const builtInDiscoveryAdapterRegistry =
  createBuiltInDiscoveryAdapterRegistry();
