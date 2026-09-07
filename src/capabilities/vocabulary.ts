/**
 * The normalized capability vocabulary is deliberately closed. Adapters may
 * recognize more vendor-specific labels, but only these values can influence
 * vendor-neutral routing.
 */
export const CAPABILITY_VOCABULARY_VERSION = "1.0" as const;

export const CAPABILITY_NAMES = Object.freeze([
  "headless",
  "model-selection",
  "continue",
  "fork",
  "mcp",
  "repository-access",
  "github-context",
  "parallel-execution",
  "local-models",
] as const);

export type CapabilityName = (typeof CAPABILITY_NAMES)[number];

export interface CapabilityVocabulary {
  readonly schemaVersion: 1;
  readonly version: typeof CAPABILITY_VOCABULARY_VERSION;
  readonly capabilities: readonly CapabilityName[];
}

export const CAPABILITY_VOCABULARY: CapabilityVocabulary = Object.freeze({
  schemaVersion: 1,
  version: CAPABILITY_VOCABULARY_VERSION,
  capabilities: CAPABILITY_NAMES,
});

const CAPABILITY_ALIASES: Readonly<Record<string, CapabilityName>> = {
  headless: "headless",
  "non-interactive": "headless",
  "model-selection": "model-selection",
  "model_selection": "model-selection",
  models: "model-selection",
  continue: "continue",
  resume: "continue",
  fork: "fork",
  mcp: "mcp",
  "model-context-protocol": "mcp",
  "repository-access": "repository-access",
  "repository_access": "repository-access",
  repository: "repository-access",
  "github-context": "github-context",
  "github_context": "github-context",
  github: "github-context",
  "parallel-execution": "parallel-execution",
  "parallel_execution": "parallel-execution",
  parallel: "parallel-execution",
  "local-models": "local-models",
  "local_models": "local-models",
  "local-model": "local-models",
};

/**
 * Normalize an adapter/vendor label to the stable vocabulary. Unknown labels
 * are rejected rather than being persisted as capabilities.
 */
export function normalizeCapabilityName(
  value: unknown,
): CapabilityName | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value.trim().toLowerCase().replace(/\s+/g, "-");
  return CAPABILITY_ALIASES[normalized];
}

export function isCapabilityName(value: unknown): value is CapabilityName {
  return (
    typeof value === "string" &&
    CAPABILITY_NAMES.some((capability) => capability === value)
  );
}
