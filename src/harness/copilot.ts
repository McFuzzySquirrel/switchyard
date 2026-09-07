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
 * Converts only GitHub Copilot CLI's advertised labels to the shared
 * vocabulary. This module is the sole location for Copilot-specific parsing.
 */
export function parseGitHubCopilotCapabilities(
  helpText: string,
): readonly CapabilityName[] {
  const labels: string[] = [];

  if (/--prompt\b/i.test(helpText)) labels.push("headless");
  if (/--model\b/i.test(helpText)) labels.push("model-selection");
  if (/(?:--continue\b|--resume\b)/i.test(helpText)) labels.push("resume");
  if (/\bmcp\b|model context protocol/i.test(helpText)) labels.push("mcp");
  if (/\b(?:pull requests?|issues?)\b|\bgithub(?:\.com| context)\b/i.test(helpText)) {
    labels.push("github-context");
  }

  return [...new Set(labels.map(normalizeCapabilityName).filter(
    (capability): capability is CapabilityName => capability !== undefined,
  ))];
}

export function createGitHubCopilotDiscoveryAdapter(): HarnessDiscoveryAdapter {
  return createHarnessDiscoveryAdapter({
    id: "copilot",
    displayName: "GitHub Copilot",
    command: "copilot",
    versionCandidateArgs: [["--version"]],
    helpCandidateArgs: [["--help"]],
    parseCapabilities: parseGitHubCopilotCapabilities,
  });
}

/** The built-in, discovery-only GitHub Copilot CLI integration. */
export const githubCopilotDiscoveryAdapter = createGitHubCopilotDiscoveryAdapter();

/**
 * Runtime configuration for the full GitHub Copilot {@link HarnessAdapter}.
 * See {@link OpenCodeAdapterOptions} in `./opencode.ts` for the shared
 * rationale: these fields are resolved once and bound by closure so every
 * operation on the instance agrees on the same executable and probe policy.
 */
export interface GitHubCopilotAdapterOptions extends HarnessDiscoveryOptions {}

/**
 * Creates the full GitHub Copilot adapter. Execution, verification, resume,
 * and fork are not implemented yet, so every non-discovery operation fails
 * before any process launch via `throwUnsupportedOperation`, and
 * `supportedOperations` reports the same restriction declaratively.
 */
export function createGitHubCopilotAdapter(
  options: GitHubCopilotAdapterOptions = {},
): HarnessAdapter {
  const discoveryAdapter = createGitHubCopilotDiscoveryAdapter();
  const resolvedDiscoveryOptions: HarnessDiscoveryOptions = Object.freeze({ ...options });

  return Object.freeze({
    id: "copilot",
    supportedOperations: DISCOVERY_ONLY_OPERATIONS,
    async discover() {
      return discoveryAdapter.discover(resolvedDiscoveryOptions);
    },
    async verify(
      _capabilities: readonly CapabilityName[],
      _context: ProbeContext,
    ): Promise<readonly VerificationResult[]> {
      return throwUnsupportedOperation("copilot", "verify");
    },
    async execute(_request: ExecutionRequest): Promise<ExecutionResult> {
      return throwUnsupportedOperation("copilot", "execute");
    },
    async resume(_request: ResumeRequest): Promise<ExecutionResult> {
      return throwUnsupportedOperation("copilot", "resume");
    },
    async fork(_request: ForkRequest): Promise<ForkResult> {
      return throwUnsupportedOperation("copilot", "fork");
    },
  });
}
