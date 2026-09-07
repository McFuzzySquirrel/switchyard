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

export interface StageInput {
  readonly name: string;
  readonly fromStage: string;
  readonly artifact?: string;
  readonly context?: readonly string[];
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

/** Validates the complete graph and all handoff declarations before execution. */
export function validateWorkflow(input: unknown): ValidationResult<ValidatedWorkflow> {
  const issues: SchemaIssue[] = [];
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return { success: false, issues: [issue("$", "must be an object")] };
  }
  const value = input as Record<string, unknown>;
  if (typeof value.id !== "string" || !ID.test(value.id)) issues.push(issue("$.id", "must be a valid identifier"));
  if (typeof value.workspace !== "string" || value.workspace.length === 0) issues.push(issue("$.workspace", "must be a non-empty path"));
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
    if (typeof stage.id !== "string" || !ID.test(stage.id)) issues.push(issue(`${p}.id`, "must be a valid identifier"));
    else if (byId.has(stage.id)) issues.push(issue(`${p}.id`, "must be unique"));
    if (typeof stage.task !== "string" || stage.task.trim() === "" || stage.task.length > MAX_TEXT) issues.push(issue(`${p}.task`, "must be a non-empty bounded string"));
    if (!isTaskRequirements(stage.requirements) && !(
      Array.isArray(stage.requirements) &&
      stage.requirements.every((x) => typeof x === "string" && isCapabilityName(x)) &&
      new Set(stage.requirements).size === stage.requirements.length
    )) {
      issues.push(issue(`${p}.requirements`, "must be task requirements or a capability list"));
    }
    if (stage.operation !== undefined && stage.operation !== "execute") issues.push(issue(`${p}.operation`, "must be 'execute'"));
    if (stage.dependsOn !== undefined && (!Array.isArray(stage.dependsOn) || stage.dependsOn.some((dependency) => typeof dependency !== "string"))) {
      issues.push(issue(`${p}.dependsOn`, "must be an array of stage identifiers"));
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
      if (typeof candidate.name !== "string" || !ID.test(candidate.name) || names.has(candidate.name)) issues.push(issue(`$.stages.${stage.id}.outputs`, "artifact names must be unique valid identifiers"));
      if (typeof candidate.name === "string") names.add(candidate.name);
      if (!["file", "directory", "metadata"].includes(candidate.kind ?? "")) issues.push(issue(`$.stages.${stage.id}.outputs`, "has invalid kind"));
      if (candidate.path !== undefined && (typeof candidate.path !== "string" || !pathInside(workspace, candidate.path) || isAbsolute(candidate.path))) issues.push(issue(`$.stages.${stage.id}.outputs.${candidate.name ?? "?"}.path`, "must remain inside the workflow workspace"));
    }
    for (const input of stage.inputs ?? []) {
      if (typeof input !== "object" || input === null || Array.isArray(input)) {
        issues.push(issue(`$.stages.${stage.id}.inputs`, "must contain input objects"));
        continue;
      }
      const candidate = input as Partial<StageInput>;
      if (typeof candidate.name !== "string" || !ID.test(candidate.name)) issues.push(issue(`$.stages.${stage.id}.inputs`, "input names must be valid identifiers"));
      if (typeof candidate.fromStage !== "string") {
        issues.push(issue(`$.stages.${stage.id}.inputs.${candidate.name ?? "?"}`, "must declare a source stage"));
        continue;
      }
      if (!byId.has(candidate.fromStage)) issues.push(issue(`$.stages.${stage.id}.inputs`, `unknown source stage '${candidate.fromStage}'`));
      else if (!(stage.dependsOn ?? []).includes(candidate.fromStage)) issues.push(issue(`$.stages.${stage.id}.inputs.${candidate.name ?? "?"}`, "source stage must be a declared dependency"));
      const source = byId.get(candidate.fromStage);
      if (candidate.artifact !== undefined && (typeof candidate.artifact !== "string" || (source && !(source.outputs ?? []).some((x) => x.name === candidate.artifact)))) issues.push(issue(`$.stages.${stage.id}.inputs.${candidate.name ?? "?"}`, `artifact '${candidate.artifact}' is not declared by source stage`));
      if (candidate.context !== undefined && (!Array.isArray(candidate.context) || candidate.context.some((x) => !["status", "selectedHarness", "durationMs", "diagnostic"].includes(x)))) issues.push(issue(`$.stages.${stage.id}.inputs.${candidate.name ?? "?"}.context`, "contains undeclared context"));
    }
  }
  const order: string[] = [];
  const visiting = new Set<string>(), visited = new Set<string>();
  function visit(id: string): void {
    if (visiting.has(id)) { issues.push(issue("$.stages", "dependency graph contains a cycle")); return; }
    if (visited.has(id)) return;
    visiting.add(id);
    for (const dep of byId.get(id)?.dependsOn ?? []) if (byId.has(dep)) visit(dep);
    visiting.delete(id); visited.add(id); order.push(id);
  }
  for (const id of byId.keys()) visit(id);
  if (issues.length) return { success: false, issues };
  return { success: true, value: { ...(value as unknown as WorkflowDefinition), schemaVersion: COMPOSITION_SCHEMA_VERSION, stages: [...byId.values()], order }, issues: [] };
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
