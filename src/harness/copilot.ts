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
  DISCOVERY_AND_EXECUTION_OPERATIONS,
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
import { executeProcess } from "./process.ts";
import {
  parseProviderHelpSurface,
  type ProviderCapabilityDescriptor,
} from "./discovery-adapter.ts";

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

export function parseGitHubCopilotProviderCapabilities(
  helpText: string,
): readonly ProviderCapabilityDescriptor[] {
  const descriptors = [...parseProviderHelpSurface(helpText)];
  if (
    /--prompt\b/i.test(helpText) &&
    !descriptors.some((descriptor) => descriptor.id === "option:-prompt")
  ) {
    descriptors.unshift({
      id: "option:-prompt",
      label: "--prompt",
      kind: "option",
    });
  }
  return descriptors;
}

export function createGitHubCopilotDiscoveryAdapter(): HarnessDiscoveryAdapter {
  return createHarnessDiscoveryAdapter({
    id: "copilot",
    displayName: "GitHub Copilot",
    command: "copilot",
    versionCandidateArgs: [["--version"]],
    helpCandidateArgs: [["--help"]],
    parseCapabilities: parseGitHubCopilotCapabilities,
    parseProviderCapabilities: parseGitHubCopilotProviderCapabilities,
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
 * Creates the GitHub Copilot adapter. Prompt execution uses Copilot's
 * non-interactive `--prompt` mode with a direct argument array. Copilot
 * supports resuming sessions, but has no provider fork operation.
 */
export function createGitHubCopilotAdapter(
  options: GitHubCopilotAdapterOptions = {},
): HarnessAdapter {
  const discoveryAdapter = createGitHubCopilotDiscoveryAdapter();
  const resolvedDiscoveryOptions: HarnessDiscoveryOptions = Object.freeze({ ...options });

  return Object.freeze({
    id: "copilot",
    supportedOperations: Object.freeze({
      ...DISCOVERY_AND_EXECUTION_OPERATIONS,
      resume: true,
    }),
    async discover() {
      return discoveryAdapter.discover(resolvedDiscoveryOptions);
    },
    async verify(
      _capabilities: readonly CapabilityName[],
      _context: ProbeContext,
    ): Promise<readonly VerificationResult[]> {
      return throwUnsupportedOperation("copilot", "verify");
    },
    async execute(request: ExecutionRequest): Promise<ExecutionResult> {
      const executable = resolvedDiscoveryOptions.executable ??
        resolvedDiscoveryOptions.configuredExecutable ??
        "copilot";
      return executeProcess(executable, ["--prompt", request.task], {
        ...request,
        cwd: request.cwd ?? resolvedDiscoveryOptions.cwd,
        env: { ...resolvedDiscoveryOptions.env, ...request.env },
        timeoutMs: request.timeoutMs ?? resolvedDiscoveryOptions.timeoutMs,
        maxOutputLength: request.maxOutputLength ?? resolvedDiscoveryOptions.maxOutputLength,
        nonInteractive: request.nonInteractive ?? true,
      });
    },
    async resume(request: ResumeRequest): Promise<ExecutionResult> {
      const executable = resolvedDiscoveryOptions.executable ??
        resolvedDiscoveryOptions.configuredExecutable ?? "copilot";
      const args = [`--resume=${request.sessionId}`];
      if (request.task !== undefined) args.push("--prompt", request.task);
      return executeProcess(executable, args, {
        task: request.task ?? "",
        cwd: request.cwd ?? resolvedDiscoveryOptions.cwd,
        env: { ...resolvedDiscoveryOptions.env, ...request.env },
        environmentPolicy: request.environmentPolicy,
        timeoutMs: request.timeoutMs ?? resolvedDiscoveryOptions.timeoutMs,
        maxOutputLength: request.maxOutputLength ?? resolvedDiscoveryOptions.maxOutputLength,
        signal: request.signal,
        nonInteractive: true,
      });
    },
    async fork(_request: ForkRequest): Promise<ForkResult> {
      return throwUnsupportedOperation("copilot", "fork");
    },
  });
}
