import {
  normalizeCapabilityName,
  type CapabilityName,
} from "../capabilities/vocabulary.ts";
import {
  createHarnessDiscoveryAdapter,
  type HarnessDiscoveryAdapter,
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
