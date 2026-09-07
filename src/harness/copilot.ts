import {
  normalizeCapabilityName,
  type CapabilityName,
} from "../capabilities/vocabulary.ts";
import {
  createHarnessDiscoveryAdapter,
  type HarnessDiscoveryAdapter,
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
