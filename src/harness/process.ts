import { spawn } from "node:child_process";
import { performance } from "node:perf_hooks";

import { boundExcerpt, redactSecrets } from "../discovery/probe.ts";
import type {
  ExecutionEnvironmentPolicy,
  ExecutionRequest,
  ExecutionResult,
} from "./adapter.ts";

export const DEFAULT_EXECUTION_TIMEOUT_MS = 30_000;
export const DEFAULT_EXECUTION_MAX_OUTPUT_LENGTH = 64 * 1024;

export interface ProcessExecutionOptions {
  readonly executable: string;
  readonly args?: readonly string[];
  readonly request: ExecutionRequest;
}

interface CapturedOutput {
  value: string;
  truncated: boolean;
}

function captureOutput(target: CapturedOutput, chunk: string, limit: number): void {
  if (target.value.length >= limit) {
    target.truncated = true;
    return;
  }
  const remaining = limit - target.value.length;
  if (chunk.length > remaining) {
    target.value += chunk.slice(0, remaining);
    target.truncated = true;
  } else {
    target.value += chunk;
  }
}

function finalizeOutput(output: CapturedOutput, limit: number): string {
  if (!output.truncated) return output.value;
  const marker = "\n[truncated]";
  if (limit <= marker.length) return marker.slice(0, limit);
  return `${output.value.slice(0, limit - marker.length)}${marker}`;
}

function positiveLimit(value: number | undefined, fallback: number): number {
  return value === undefined || !Number.isFinite(value) || value <= 0
    ? fallback
    : Math.floor(value);
}

function nonNegativeLimit(value: number | undefined, fallback: number): number {
  return value === undefined || !Number.isFinite(value) || value < 0
    ? fallback
    : Math.floor(value);
}

function buildEnvironment(
  policy: ExecutionEnvironmentPolicy | undefined,
  explicit: Readonly<Record<string, string | undefined>> | undefined,
  nonInteractive: boolean,
): NodeJS.ProcessEnv {
  const inherited = policy?.inherit === false ? {} : process.env;
  const allow = policy?.allow === undefined ? undefined : new Set(policy.allow);
  const deny = new Set(policy?.deny ?? []);
  const environment: NodeJS.ProcessEnv = {};

  for (const [name, value] of Object.entries(inherited)) {
    if (allow !== undefined && !allow.has(name)) continue;
    if (deny.has(name) || value === undefined) continue;
    environment[name] = value;
  }
  for (const [name, value] of Object.entries(explicit ?? {})) {
    if (deny.has(name) || value === undefined) {
      delete environment[name];
    } else {
      environment[name] = value;
    }
  }
  if (nonInteractive) {
    environment.CI = "1";
    environment.NONINTERACTIVE = "1";
    environment.TERM ??= "dumb";
  }
  return environment;
}

function diagnostic(error: string): string {
  return boundExcerpt(redactSecrets(error), 4096);
}

async function terminateProcessTree(
  child: ReturnType<typeof spawn>,
): Promise<void> {
  if (child.pid === undefined) return;

  if (process.platform === "win32") {
    await new Promise<void>((resolve) => {
      const killer = spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], {
        stdio: "ignore",
        windowsHide: true,
      });
      killer.once("error", () => resolve());
      killer.once("close", () => resolve());
    });
    return;
  }

  try {
    process.kill(-child.pid, "SIGTERM");
  } catch {
    try {
      child.kill("SIGTERM");
    } catch {
      // The process may have exited between the close check and termination.
    }
  }
  await new Promise<void>((resolve) => setTimeout(resolve, 250));
  try {
    process.kill(-child.pid, "SIGKILL");
  } catch {
    try {
      child.kill("SIGKILL");
    } catch {
      // The process may already be gone.
    }
  }
  if (child.exitCode !== null || child.signalCode !== null) return;
  await new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, 250);
    child.once("close", () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

function resultForNonLaunch(
  request: ExecutionRequest,
  status: "cancelled" | "dry-run",
  durationMs: number,
): ExecutionResult {
  return {
    succeeded: false,
    status,
    failureCategory: status === "cancelled" ? "cancelled" : "none",
    exitCode: null,
    stdout: "",
    stderr: "",
    stdoutTruncated: false,
    stderrTruncated: false,
    durationMs,
    ...(status === "cancelled" ? { error: "Process execution was cancelled" } : {}),
  };
}

/**
 * Runs an adapter-translated argv directly without a shell. Output and
 * lifecycle state are bounded and stable so adapters do not need to duplicate
 * process cleanup or failure classification.
 */
export async function executeProcess(
  executable: string,
  args: readonly string[] = [],
  request: ExecutionRequest,
): Promise<ExecutionResult> {
  const startedAt = performance.now();
  const maxOutputLength = nonNegativeLimit(
    request.maxOutputLength,
    DEFAULT_EXECUTION_MAX_OUTPUT_LENGTH,
  );
  const timeoutMs = positiveLimit(request.timeoutMs, DEFAULT_EXECUTION_TIMEOUT_MS);

  if (request.dryRun === true) {
    return resultForNonLaunch(request, "dry-run", Math.round(performance.now() - startedAt));
  }
  if (request.signal?.aborted) {
    return resultForNonLaunch(request, "cancelled", Math.round(performance.now() - startedAt));
  }

  return new Promise<ExecutionResult>((resolve) => {
    const stdout: CapturedOutput = { value: "", truncated: false };
    const stderr: CapturedOutput = { value: "", truncated: false };
    let child: ReturnType<typeof spawn> | undefined;
    let timer: NodeJS.Timeout | undefined;
    let finished = false;
    let termination: "timeout" | "cancelled" | undefined;
    let cleanupPromise: Promise<void> | undefined;

    const finish = (
      status: "succeeded" | "failed" | "timed-out" | "cancelled" | "unavailable",
      code: number | null,
      signal: string | null,
      error?: string,
    ) => {
      if (finished) return;
      finished = true;
      if (timer) clearTimeout(timer);
      request.signal?.removeEventListener("abort", onAbort);
      const stdoutValue = finalizeOutput(stdout, maxOutputLength);
      const stderrValue = finalizeOutput(stderr, maxOutputLength);
      const succeeded = status === "succeeded";
      resolve({
        succeeded,
        status,
        failureCategory: succeeded
          ? "none"
          : status === "timed-out"
            ? "timeout"
            : status === "cancelled"
              ? "cancelled"
              : status === "unavailable"
                ? "unavailable"
                : "execution-failure",
        exitCode: code,
        ...(signal === null ? {} : { signal }),
        stdout: stdoutValue,
        stderr: stderrValue,
        stdoutTruncated: stdout.truncated,
        stderrTruncated: stderr.truncated,
        durationMs: Math.round(performance.now() - startedAt),
        ...(error === undefined ? {} : { error: diagnostic(error) }),
      });
    };

    const stop = (reason: "timeout" | "cancelled") => {
      if (finished || termination !== undefined) return;
      termination = reason;
      if (child === undefined) {
        finish(
          reason === "timeout" ? "timed-out" : "cancelled",
          null,
          null,
          reason === "timeout"
            ? `Process timed out after ${timeoutMs}ms`
            : "Process execution was cancelled",
        );
        return;
      }
      cleanupPromise = terminateProcessTree(child);
    };
    const onAbort = () => stop("cancelled");
    request.signal?.addEventListener("abort", onAbort, { once: true });
    if (finished) return;

    try {
      child = spawn(executable, [...args], {
        cwd: request.cwd,
        env: buildEnvironment(
          request.environmentPolicy,
          request.env,
          request.nonInteractive === true,
        ),
        stdio: ["pipe", "pipe", "pipe"],
        detached: process.platform !== "win32",
        windowsHide: true,
        shell: false,
      });
    } catch (error: unknown) {
      finish(
        "unavailable",
        null,
        null,
        error instanceof Error ? error.message : String(error),
      );
      return;
    }

    const launchedChild = child;
    timer = setTimeout(() => stop("timeout"), timeoutMs);
    launchedChild.stdout?.setEncoding("utf8");
    launchedChild.stderr?.setEncoding("utf8");
    launchedChild.stdout?.on("data", (chunk: string | Buffer) =>
      captureOutput(stdout, chunk.toString(), maxOutputLength),
    );
    launchedChild.stderr?.on("data", (chunk: string | Buffer) =>
      captureOutput(stderr, chunk.toString(), maxOutputLength),
    );
    launchedChild.once("error", (error: Error) => {
      if (termination === undefined) finish("unavailable", null, null, error.message);
    });
    launchedChild.once("close", (code: number | null, signal: string | null) => {
      if (termination === "timeout") {
        void (cleanupPromise ?? Promise.resolve()).then(() =>
          finish("timed-out", null, signal, `Process timed out after ${timeoutMs}ms`),
        );
      } else if (termination === "cancelled") {
        void (cleanupPromise ?? Promise.resolve()).then(() =>
          finish("cancelled", null, signal, "Process execution was cancelled"),
        );
      } else if (code === 0) {
        finish("succeeded", 0, signal);
      } else {
        finish(
          "failed",
          code,
          signal,
          `Process exited with code ${code}${signal ? ` (signal: ${signal})` : ""}`,
        );
      }
    });

    if (request.stdin !== undefined) {
      launchedChild.stdin?.end(request.stdin);
    } else {
      launchedChild.stdin?.end();
    }
  });
}

export function runProcess(options: ProcessExecutionOptions): Promise<ExecutionResult> {
  return executeProcess(options.executable, options.args ?? [], options.request);
}
