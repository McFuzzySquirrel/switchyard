import { resolve, relative, isAbsolute, sep } from "node:path";
import {
  type SchemaIssue,
  type TaskRequirements,
  validateTaskRequirements,
  type ValidationResult,
} from "../discovery/schema.ts";
import { isCapabilityName } from "../capabilities/vocabulary.ts";

export const COMPOSITION_SCHEMA_VERSION = 1 as const;

export type StageOperation = "execute";
export type ArtifactKind = "file" | "directory" | "metadata";

export interface WorkflowArtifact {
  readonly name: string;
  readonly path?: string;
  readonly kind: ArtifactKind;
  readonly description?: string;
}

export type StageContextField = "status" | "selectedHarness" | "durationMs" | "diagnostic";

export interface StageInput {
  readonly name: string;
  readonly fromStage: string;
  readonly artifact?: string;
  readonly context?: readonly StageContextField[];
}

export interface WorkflowStage {
  readonly id: string;
  readonly operation?: StageOperation;
  readonly dependsOn?: readonly string[];
  readonly requirements: TaskRequirements | readonly string[];
  readonly task: string;
  readonly outputs?: readonly WorkflowArtifact[];
  readonly inputs?: readonly StageInput[];
}

export interface WorkflowDefinition {
  readonly schemaVersion?: typeof COMPOSITION_SCHEMA_VERSION;
  readonly id: string;
  readonly workspace: string;
  readonly stages: readonly WorkflowStage[];
}

export interface ValidatedWorkflow extends WorkflowDefinition {
  readonly schemaVersion: typeof COMPOSITION_SCHEMA_VERSION;
  readonly order: readonly string[];
}

const ID = /^[a-z0-9][a-z0-9._-]*$/;
const MAX_TEXT = 32_768;
const STAGE_CONTEXT_FIELDS: readonly StageContextField[] = ["status", "selectedHarness", "durationMs", "diagnostic"];
const WORKFLOW_KEYS = ["schemaVersion", "id", "workspace", "stages"] as const;
const STAGE_KEYS = ["id", "operation", "dependsOn", "requirements", "task", "outputs", "inputs"] as const;
const ARTIFACT_KEYS = ["name", "path", "kind", "description"] as const;
const INPUT_KEYS = ["name", "fromStage", "artifact", "context"] as const;

function issue(path: string, message: string): SchemaIssue {
  return { path, message };
}

function isTaskRequirements(value: unknown): value is TaskRequirements {
  return validateTaskRequirements(value).success;
}

function pathInside(workspace: string, candidate: string): boolean {
  const root = resolve(workspace);
  const target = resolve(root, candidate);
  const rel = relative(root, target);
  return rel === "" || (rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
}

function isIdentifier(value: unknown): value is string {
  return typeof value === "string" && ID.test(value);
}

function hasOnlyKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  path: string,
  issues: SchemaIssue[],
): void {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) {
      issues.push(issue(`${path}.${key}`, "is not a recognized field"));
    }
  }
}

function isBoundedText(value: unknown, maxLength = MAX_TEXT): value is string {
  return typeof value === "string" &&
    value.length > 0 &&
    value.length <= maxLength &&
    !value.includes("\u0000");
}

/** Validates the complete graph and all handoff declarations before execution. */
export function validateWorkflow(input: unknown): ValidationResult<ValidatedWorkflow> {
  const issues: SchemaIssue[] = [];
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return { success: false, issues: [issue("$", "must be an object")] };
  }
  const value = input as Record<string, unknown>;
  hasOnlyKeys(value, WORKFLOW_KEYS, "$", issues);
  if (!isIdentifier(value.id)) issues.push(issue("$.id", "must be a valid identifier"));
  if (!isBoundedText(value.workspace) || (value.workspace as string).trim() === "") {
    issues.push(issue("$.workspace", "must be a non-empty path without NUL characters"));
  }
  if (!Array.isArray(value.stages) || value.stages.length === 0) {
    issues.push(issue("$.stages", "must contain at least one stage"));
  }
  const stages = Array.isArray(value.stages) ? value.stages as unknown[] : [];
  const byId = new Map<string, WorkflowStage>();
  stages.forEach((raw, index) => {
    const p = `$.stages[${index}]`;
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
      issues.push(issue(p, "must be an object")); return;
    }
    const stage = raw as Record<string, unknown>;
    hasOnlyKeys(stage, STAGE_KEYS, p, issues);
    if (typeof stage.id !== "string" || !ID.test(stage.id)) issues.push(issue(`${p}.id`, "must be a valid identifier"));
    else if (byId.has(stage.id)) issues.push(issue(`${p}.id`, "must be unique"));
    if (!isBoundedText(stage.task) || (stage.task as string).trim() === "") issues.push(issue(`${p}.task`, "must be a non-empty bounded string without NUL characters"));
    if (!isTaskRequirements(stage.requirements) && !(
      Array.isArray(stage.requirements) &&
      stage.requirements.every((x) => typeof x === "string" && isCapabilityName(x)) &&
      new Set(stage.requirements).size === stage.requirements.length
    )) {
      issues.push(issue(`${p}.requirements`, "must be task requirements or a capability list"));
    }
    if (stage.operation !== undefined && stage.operation !== "execute") issues.push(issue(`${p}.operation`, "must be 'execute'"));
    if (stage.dependsOn !== undefined && (
      !Array.isArray(stage.dependsOn) ||
      stage.dependsOn.some((dependency) => !isIdentifier(dependency)) ||
      new Set(stage.dependsOn).size !== stage.dependsOn.length
    )) {
      issues.push(issue(`${p}.dependsOn`, "must be an array of unique stage identifiers"));
    }
    if (stage.outputs !== undefined && !Array.isArray(stage.outputs)) issues.push(issue(`${p}.outputs`, "must be an array"));
    if (stage.inputs !== undefined && !Array.isArray(stage.inputs)) issues.push(issue(`${p}.inputs`, "must be an array"));
    const normalized: WorkflowStage = {
      id: stage.id as string,
      operation: stage.operation as StageOperation | undefined,
      dependsOn: Array.isArray(stage.dependsOn) ? stage.dependsOn as string[] : [],
      requirements: stage.requirements as TaskRequirements | string[],
      task: stage.task as string,
      outputs: Array.isArray(stage.outputs) ? stage.outputs as WorkflowArtifact[] : [],
      inputs: Array.isArray(stage.inputs) ? stage.inputs as StageInput[] : [],
    };
    if (typeof stage.id === "string" && ID.test(stage.id)) byId.set(stage.id, normalized);
  });
  if (issues.length) return { success: false, issues };
  const workspace = value.workspace as string;
  if (value.schemaVersion !== undefined && value.schemaVersion !== COMPOSITION_SCHEMA_VERSION) {
    issues.push(issue("$.schemaVersion", `must be ${COMPOSITION_SCHEMA_VERSION}`));
  }
  for (const stage of byId.values()) {
    for (const dependency of stage.dependsOn ?? []) {
      if (!byId.has(dependency)) issues.push(issue(`$.stages.${stage.id}.dependsOn`, `unknown stage '${dependency}'`));
    }
    const names = new Set<string>();
    for (const artifact of stage.outputs ?? []) {
      if (typeof artifact !== "object" || artifact === null || Array.isArray(artifact)) {
        issues.push(issue(`$.stages.${stage.id}.outputs`, "must contain artifact objects"));
        continue;
      }
      const candidate = artifact as Partial<WorkflowArtifact>;
      hasOnlyKeys(candidate as Record<string, unknown>, ARTIFACT_KEYS, `$.stages.${stage.id}.outputs`, issues);
      if (typeof candidate.name !== "string" || !ID.test(candidate.name) || names.has(candidate.name)) issues.push(issue(`$.stages.${stage.id}.outputs`, "artifact names must be unique valid identifiers"));
      if (typeof candidate.name === "string") names.add(candidate.name);
      if (!["file", "directory", "metadata"].includes(candidate.kind ?? "")) issues.push(issue(`$.stages.${stage.id}.outputs`, "has invalid kind"));
      const artifactPath = candidate.path;
      if (candidate.kind === "metadata" && artifactPath !== undefined) {
        issues.push(issue(`$.stages.${stage.id}.outputs.${candidate.name ?? "?"}.path`, "metadata artifacts must not declare a path"));
      } else if (candidate.kind !== "metadata" && (
        typeof artifactPath !== "string" ||
        artifactPath.trim() === "" ||
        !pathInside(workspace, artifactPath) ||
        resolve(workspace, artifactPath) === resolve(workspace) ||
        isAbsolute(artifactPath)
      )) {
        issues.push(issue(`$.stages.${stage.id}.outputs.${candidate.name ?? "?"}.path`, "file and directory artifacts must use a workspace-contained relative path inside the workflow workspace"));
      }
      if (candidate.description !== undefined && !isBoundedText(candidate.description)) {
        issues.push(issue(`$.stages.${stage.id}.outputs.${candidate.name ?? "?"}.description`, "must be a bounded string"));
      }
    }
    const inputNames = new Set<string>();
    for (const input of stage.inputs ?? []) {
      if (typeof input !== "object" || input === null || Array.isArray(input)) {
        issues.push(issue(`$.stages.${stage.id}.inputs`, "must contain input objects"));
        continue;
      }
      const candidate = input as Partial<StageInput>;
      hasOnlyKeys(candidate as Record<string, unknown>, INPUT_KEYS, `$.stages.${stage.id}.inputs`, issues);
      if (typeof candidate.name !== "string" || !ID.test(candidate.name) || inputNames.has(candidate.name)) issues.push(issue(`$.stages.${stage.id}.inputs`, "input names must be unique valid identifiers"));
      if (typeof candidate.name === "string") inputNames.add(candidate.name);
      if (typeof candidate.fromStage !== "string" || !ID.test(candidate.fromStage)) {
        issues.push(issue(`$.stages.${stage.id}.inputs.${candidate.name ?? "?"}`, "must declare a source stage"));
        continue;
      }
      if (!byId.has(candidate.fromStage)) issues.push(issue(`$.stages.${stage.id}.inputs`, `unknown source stage '${candidate.fromStage}'`));
      else if (!(stage.dependsOn ?? []).includes(candidate.fromStage)) issues.push(issue(`$.stages.${stage.id}.inputs.${candidate.name ?? "?"}`, "source stage must be a declared dependency"));
      const source = byId.get(candidate.fromStage);
      if (candidate.artifact === undefined && candidate.context === undefined) {
        issues.push(issue(`$.stages.${stage.id}.inputs.${candidate.name ?? "?"}`, "must declare an artifact or context"));
      }
      if (candidate.artifact !== undefined && (
        !isIdentifier(candidate.artifact) ||
        (source && !(source.outputs ?? []).some((x) => x.name === candidate.artifact))
      )) issues.push(issue(`$.stages.${stage.id}.inputs.${candidate.name ?? "?"}`, `artifact '${candidate.artifact}' is not declared by source stage`));
      if (candidate.context !== undefined && (
        !Array.isArray(candidate.context) ||
        candidate.context.length === 0 ||
        candidate.context.some((x) => !(STAGE_CONTEXT_FIELDS as readonly string[]).includes(x)) ||
        new Set(candidate.context).size !== candidate.context.length
      )) issues.push(issue(`$.stages.${stage.id}.inputs.${candidate.name ?? "?"}.context`, "contains undeclared or duplicate context"));
    }
  }
  const order: string[] = [];
  const dependencies = new Map<string, number>();
  const dependents = new Map<string, string[]>();
  for (const id of byId.keys()) {
    dependencies.set(id, 0);
    dependents.set(id, []);
  }
  for (const stage of byId.values()) {
    const knownDependencies = (stage.dependsOn ?? []).filter((dependency) => byId.has(dependency));
    dependencies.set(stage.id, knownDependencies.length);
    for (const dependency of knownDependencies) dependents.get(dependency)?.push(stage.id);
  }
  const ready = [...byId.keys()].filter((id) => dependencies.get(id) === 0);
  while (ready.length) {
    const id = ready.shift()!;
    order.push(id);
    for (const dependent of dependents.get(id) ?? []) {
      const remaining = dependencies.get(dependent)! - 1;
      dependencies.set(dependent, remaining);
      if (remaining === 0) ready.push(dependent);
    }
  }
  if (order.length !== byId.size) issues.push(issue("$.stages", "dependency graph contains a cycle"));
  if (issues.length) return { success: false, issues };
  // `order` is an execution detail produced by validation, not a user-facing
  // schema field. Keep it non-enumerable so a validated value can safely be
  // passed back to `executeWorkflow` without widening the accepted input
  // schema or allowing callers to smuggle an execution order.
  const validated = {
    ...(value as unknown as WorkflowDefinition),
    schemaVersion: COMPOSITION_SCHEMA_VERSION,
    stages: [...byId.values()],
  } as unknown as ValidatedWorkflow;
  Object.defineProperty(validated, "order", {
    configurable: false,
    enumerable: false,
    value: Object.freeze(order),
    writable: false,
  });
  return { success: true, value: validated, issues: [] };
}

export function assertWorkflow(input: unknown): ValidatedWorkflow {
  const result = validateWorkflow(input);
  if (!result.success) throw new WorkflowValidationError(result.issues);
  return result.value;
}

export class WorkflowValidationError extends Error {
  readonly issues: readonly SchemaIssue[];
  constructor(issues: readonly SchemaIssue[]) {
    super(`Workflow validation failed: ${issues.map((x) => `${x.path} ${x.message}`).join("; ")}`);
    this.name = "WorkflowValidationError";
    this.issues = issues;
  }
}
