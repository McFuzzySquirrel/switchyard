import {
  normalizeCapabilityName,
  type CapabilityName,
} from "../capabilities/vocabulary.ts";
import {
  createHarnessDiscoveryAdapter,
  type HarnessDiscoveryAdapter,
  type HarnessDiscoveryOptions,
} from "./discovery-adapter.ts";
import {
  DISCOVERY_ONLY_OPERATIONS,
  throwUnsupportedOperation,
  type ExecutionRequest,
  type ExecutionResult,
  type ForkRequest,
  type ForkResult,
  type HarnessAdapter,
  type ProbeContext,
  type ResumeRequest,
  type VerificationResult,
} from "./adapter.ts";

/**
 * Converts only documented OpenCode help labels to shared vocabulary terms.
 * Unknown OpenCode text is deliberately ignored rather than leaking a
 * vendor-specific capability into routing.
 */
export function parseOpenCodeCapabilities(
  helpText: string,
): readonly CapabilityName[] {
  const labels: string[] = [];

  if (/\brun\b/i.test(helpText)) labels.push("non-interactive");
  if (/--model\b/i.test(helpText)) labels.push("model-selection");
  if (/(?:--continue\b|\bresume\b)/i.test(helpText)) labels.push("continue");
  if (/\bfork\b/i.test(helpText)) labels.push("fork");
  if (/\bmcp\b|model context protocol/i.test(helpText)) labels.push("mcp");
  if (/\b(?:ollama|local models?)\b/i.test(helpText)) labels.push("local-models");

  return [...new Set(labels.map(normalizeCapabilityName).filter(
    (capability): capability is CapabilityName => capability !== undefined,
  ))];
}

export function createOpenCodeDiscoveryAdapter(): HarnessDiscoveryAdapter {
  return createHarnessDiscoveryAdapter({
    id: "opencode",
    displayName: "OpenCode",
    command: "opencode",
    // One bounded, documented invocation for each metadata kind keeps normal
    // discovery within the expected per-harness latency budget.
    versionCandidateArgs: [["--version"]],
    helpCandidateArgs: [["--help"]],
    parseCapabilities: parseOpenCodeCapabilities,
  });
}

/** The built-in, discovery-only OpenCode integration. */
export const openCodeDiscoveryAdapter = createOpenCodeDiscoveryAdapter();

/**
 * Runtime configuration for the full OpenCode {@link HarnessAdapter}. These
 * fields are resolved once (see `src/config/resolve.ts`) and bound by
 * closure so `discover`, `verify`, `execute`, `resume`, and `fork` all agree
 * on the same executable and probe policy; none of them re-resolve
 * configuration independently.
 */
export interface OpenCodeAdapterOptions extends HarnessDiscoveryOptions {}

/**
 * Creates the full OpenCode adapter. Execution, verification, resume, and
 * fork are not implemented yet, so every non-discovery operation fails
 * before any process launch via `throwUnsupportedOperation`, and
 * `supportedOperations` reports the same restriction declaratively.
 */
export function createOpenCodeAdapter(
  options: OpenCodeAdapterOptions = {},
): HarnessAdapter {
  const discoveryAdapter = createOpenCodeDiscoveryAdapter();
  // Freeze the resolved options once so every operation on this instance
  // observes the same executable, environment, and probe policy.
  const resolvedDiscoveryOptions: HarnessDiscoveryOptions = Object.freeze({ ...options });

  return Object.freeze({
    id: "opencode",
    supportedOperations: DISCOVERY_ONLY_OPERATIONS,
    async discover() {
      return discoveryAdapter.discover(resolvedDiscoveryOptions);
    },
    async verify(
      _capabilities: readonly CapabilityName[],
      _context: ProbeContext,
    ): Promise<readonly VerificationResult[]> {
      return throwUnsupportedOperation("opencode", "verify");
    },
    async execute(_request: ExecutionRequest): Promise<ExecutionResult> {
      return throwUnsupportedOperation("opencode", "execute");
    },
    async resume(_request: ResumeRequest): Promise<ExecutionResult> {
      return throwUnsupportedOperation("opencode", "resume");
    },
    async fork(_request: ForkRequest): Promise<ForkResult> {
      return throwUnsupportedOperation("opencode", "fork");
    },
  });
}
