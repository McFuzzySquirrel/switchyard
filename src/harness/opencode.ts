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
  type SupportedOperations,
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

export function parseOpenCodeProviderCapabilities(
  helpText: string,
): readonly ProviderCapabilityDescriptor[] {
  return parseProviderHelpSurface(helpText);
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
    parseProviderCapabilities: parseOpenCodeProviderCapabilities,
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
 * Creates the OpenCode adapter. Session lifecycle operations use the same
 * bounded direct process runner as ordinary prompt execution.
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
    supportedOperations: Object.freeze({
      ...DISCOVERY_AND_EXECUTION_OPERATIONS,
      resume: true,
      fork: true,
    } satisfies SupportedOperations),
    async discover() {
      return discoveryAdapter.discover(resolvedDiscoveryOptions);
    },
    async verify(
      _capabilities: readonly CapabilityName[],
      _context: ProbeContext,
    ): Promise<readonly VerificationResult[]> {
      return throwUnsupportedOperation("opencode", "verify");
    },
    async execute(request: ExecutionRequest): Promise<ExecutionResult> {
      const executable = resolvedDiscoveryOptions.executable ??
        resolvedDiscoveryOptions.configuredExecutable ??
        "opencode";
      return executeProcess(executable, ["run", request.task], {
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
        resolvedDiscoveryOptions.configuredExecutable ?? "opencode";
      const args = ["run", "--session", request.sessionId];
      if (request.task !== undefined) args.push(request.task);
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
    async fork(request: ForkRequest): Promise<ForkResult> {
      const executable = resolvedDiscoveryOptions.executable ??
        resolvedDiscoveryOptions.configuredExecutable ?? "opencode";
      const args = ["run", "--session", request.sessionId, "--fork", "--format", "json"];
      if (request.task !== undefined) args.push(request.task);
      const result = await executeProcess(executable, args, {
        task: request.task ?? "",
        cwd: request.cwd ?? resolvedDiscoveryOptions.cwd,
        env: { ...resolvedDiscoveryOptions.env, ...request.env },
        environmentPolicy: request.environmentPolicy,
        timeoutMs: request.timeoutMs ?? resolvedDiscoveryOptions.timeoutMs,
        maxOutputLength: request.maxOutputLength ?? resolvedDiscoveryOptions.maxOutputLength,
        signal: request.signal,
        nonInteractive: true,
      });
      if (!result.succeeded) {
        throw new Error(result.error ?? "OpenCode fork failed");
      }
      const sessionId = result.stdout.match(/"(?:sessionID|sessionId|session_id)"\s*:\s*"([^"]+)"/)?.[1];
      if (sessionId === undefined) throw new Error("OpenCode fork completed without a session ID");
      return { sessionId, completedAt: new Date().toISOString() };
    },
  });
}
