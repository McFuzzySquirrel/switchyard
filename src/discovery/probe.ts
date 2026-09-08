import { spawn } from "node:child_process";
import { performance } from "node:perf_hooks";

import type { CapabilityEvidence } from "./schema.ts";

export interface ProbeOptions {
  /** Arguments to pass to the executable, e.g. ["--version"] or ["--help"]. */
  readonly args?: readonly string[];
  /** Maximum execution time in milliseconds before terminating the process. Default: 5000ms. */
  readonly timeoutMs?: number;
  /** Maximum output buffer size in characters before truncating. Default: 8192. */
  readonly maxOutputLength?: number;
  /** Working directory for the probe subprocess. Default: process.cwd(). */
  readonly cwd?: string;
  /** Custom environment variables. */
  readonly env?: Readonly<Record<string, string | undefined>>;
  /** AbortSignal for cancellation. */
  readonly signal?: AbortSignal;
}

export interface ProbeResult {
  readonly success: boolean;
  readonly exitCode: number | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly excerpt: string;
  readonly durationMs: number;
  readonly timedOut: boolean;
  readonly error?: string;
}

export interface VersionProbeOptions extends ProbeOptions {
  /** Candidate version flags to try sequentially until a version is found. Default: [["--version"], ["-v"], ["version"]] */
  readonly candidateArgs?: readonly (readonly string[])[];
}

export interface VersionProbeResult {
  readonly version?: string;
  readonly rawOutput: string;
  readonly excerpt: string;
  readonly evidence?: CapabilityEvidence;
  readonly probeResult: ProbeResult;
}

export interface HelpProbeOptions extends ProbeOptions {
  /** Candidate help flags to try sequentially until help output is obtained. Default: [["--help"], ["-h"], ["help"]] */
  readonly candidateArgs?: readonly (readonly string[])[];
}

export interface HelpProbeResult {
  readonly helpText: string;
  readonly excerpt: string;
  readonly evidence?: CapabilityEvidence;
  readonly probeResult: ProbeResult;
}

export interface HarnessMetadataProbeOptions extends ProbeOptions {
  readonly versionCandidateArgs?: readonly (readonly string[])[];
  readonly helpCandidateArgs?: readonly (readonly string[])[];
}

export interface HarnessMetadataProbeResult {
  readonly executable: string;
  readonly version?: string;
  readonly helpText?: string;
  readonly evidences: readonly CapabilityEvidence[];
  readonly status: "available" | "unavailable" | "malformed";
  readonly diagnostic?: string;
}

const DEFAULT_TIMEOUT_MS = 5000;
const DEFAULT_MAX_OUTPUT_LENGTH = 8192;

function launchCommand(
  executable: string,
  args: readonly string[],
): { executable: string; args: readonly string[] } {
  // Windows cannot launch Node scripts by their file association when shell
  // execution is disabled. Prefix them with the current Node executable while
  // preserving the explicit argv/no-shell process boundary.
  if (
    process.platform === "win32" &&
    /\.(?:cjs|js|mjs)$/i.test(executable)
  ) {
    return { executable: process.execPath, args: [executable, ...args] };
  }
  return { executable, args };
}

/** Strips ANSI escape codes from terminal output strings. */
export function stripAnsi(text: string): string {
  return text.replace(
    // eslint-disable-next-line no-control-regex
    /[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nry=><]/g,
    "",
  );
}

/** Redacts common token and secret patterns from diagnostic text. */
export function redactSecrets(text: string): string {
  return text
    .replace(
      /(?:token|password|secret|key|api[_-]?key)\s*[:=]\s*[^\s]+/gi,
      "[REDACTED]",
    )
    .replace(/\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi, "Bearer [REDACTED]");
}

/** Prepares a bounded, sanitized, non-executable excerpt string from CLI output. */
export function boundExcerpt(
  text: string,
  maxLength: number = DEFAULT_MAX_OUTPUT_LENGTH,
): string {
  if (!text) return "";
  const cleaned = redactSecrets(stripAnsi(text)).replace(/\r\n/g, "\n").trim();
  const limit = Math.max(0, Math.floor(maxLength));
  if (cleaned.length <= limit) {
    return cleaned;
  }
  const marker = "\n[truncated]";
  if (limit <= marker.length) {
    return marker.slice(0, limit);
  }
  return `${cleaned.slice(0, limit - marker.length)}${marker}`;
}

/** Extracts a semantic version string from text output. */
export function extractVersion(text: string): string | undefined {
  if (!text) return undefined;
  const clean = stripAnsi(text);
  const match = clean.match(
    /\b(?:v)?(\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?(?:\+[a-zA-Z0-9.-]+)?)\b/i,
  );
  return match ? match[1] : undefined;
}

/** Checks whether string output contains standard CLI help text keywords. */
export function isHelpOutput(text: string): boolean {
  if (!text) return false;
  return /(?:usage:|options:|commands:|flags:|subcommands:|description:|--help|-h\b)/i.test(
    text,
  );
}

/**
 * Spawns an executable directly with argument arrays in a non-interactive,
 * bounded subprocess environment. Returns structured output, duration, and exit info.
 */
export async function probeExecutable(
  executable: string,
  options: ProbeOptions = {},
): Promise<ProbeResult> {
  const args = options.args ?? [];
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxOutputLength = options.maxOutputLength ?? DEFAULT_MAX_OUTPUT_LENGTH;
  const cwd = options.cwd ?? process.cwd();

  const baseEnv: Record<string, string | undefined> = {
    ...process.env,
    CI: "1",
    NONINTERACTIVE: "1",
    TERM: "dumb",
  };
  const env = options.env ? { ...baseEnv, ...options.env } : baseEnv;

  const startTime = performance.now();

  return new Promise<ProbeResult>((resolve) => {
    let stdoutBuffer = "";
    let stderrBuffer = "";
    let stdoutTruncated = false;
    let stderrTruncated = false;
    let timedOut = false;
    let settled = false;
    let child: ReturnType<typeof spawn> | undefined;
    let timer: NodeJS.Timeout | undefined;
    let killTimer: NodeJS.Timeout | undefined;

    const cleanup = () => {
      if (timer) clearTimeout(timer);
      if (killTimer) clearTimeout(killTimer);
      if (options.signal) {
        options.signal.removeEventListener("abort", onAbort);
      }
    };

    const finish = (result: ProbeResult) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(result);
    };

    const onAbort = () => {
      if (child && !child.killed) {
        try {
          child.kill("SIGTERM");
        } catch {
          // Process may have already exited
        }
      }
      const durationMs = Math.round(performance.now() - startTime);
      finish({
        success: false,
        exitCode: null,
        stdout: stdoutBuffer,
        stderr: stderrBuffer,
        excerpt: boundExcerpt(stdoutBuffer || stderrBuffer, maxOutputLength),
        durationMs,
        timedOut: false,
        error: "Probe execution was aborted",
      });
    };

    if (options.signal) {
      if (options.signal.aborted) {
        return onAbort();
      }
      options.signal.addEventListener("abort", onAbort, { once: true });
    }

    try {
      const command = launchCommand(executable, args);
      child = spawn(command.executable, command.args, {
        cwd,
        env,
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      });
    } catch (err: unknown) {
      const durationMs = Math.round(performance.now() - startTime);
      const message = err instanceof Error ? err.message : String(err);
      return finish({
        success: false,
        exitCode: null,
        stdout: "",
        stderr: "",
        excerpt: "",
        durationMs,
        timedOut: false,
        error: message,
      });
    }

    timer = setTimeout(() => {
      timedOut = true;
      if (child && !child.killed) {
        try {
          child.kill("SIGTERM");
        } catch {
          // Process may have already exited
        }
        killTimer = setTimeout(() => {
          if (child && !child.killed) {
            try {
              child.kill("SIGKILL");
            } catch {
              // Ignore if dead
            }
          }
        }, 500);
      }
    }, timeoutMs);

    if (child.stdout) {
      child.stdout.setEncoding("utf8");
      child.stdout.on("data", (chunk: string) => {
        if (stdoutBuffer.length < maxOutputLength) {
          stdoutBuffer += chunk;
          if (stdoutBuffer.length > maxOutputLength) {
            stdoutBuffer = stdoutBuffer.slice(0, maxOutputLength);
            stdoutTruncated = true;
          }
        }
      });
    }

    if (child.stderr) {
      child.stderr.setEncoding("utf8");
      child.stderr.on("data", (chunk: string) => {
        if (stderrBuffer.length < maxOutputLength) {
          stderrBuffer += chunk;
          if (stderrBuffer.length > maxOutputLength) {
            stderrBuffer = stderrBuffer.slice(0, maxOutputLength);
            stderrTruncated = true;
          }
        }
      });
    }

    child.on("error", (err: Error) => {
      const durationMs = Math.round(performance.now() - startTime);
      finish({
        success: false,
        exitCode: null,
        stdout: stdoutBuffer,
        stderr: stderrBuffer,
        excerpt: boundExcerpt(stdoutBuffer || stderrBuffer, maxOutputLength),
        durationMs,
        timedOut: false,
        error: err.message,
      });
    });

    child.on("close", (code: number | null, signal: string | null) => {
      const durationMs = Math.round(performance.now() - startTime);

      let stdoutFinal = stdoutBuffer;
      if (stdoutTruncated) {
        stdoutFinal += "\n[truncated]";
      }
      let stderrFinal = stderrBuffer;
      if (stderrTruncated) {
        stderrFinal += "\n[truncated]";
      }

      const combinedText = stdoutFinal || stderrFinal;
      const excerpt = boundExcerpt(combinedText, maxOutputLength);

      if (timedOut) {
        return finish({
          success: false,
          exitCode: code,
          stdout: stdoutFinal,
          stderr: stderrFinal,
          excerpt,
          durationMs,
          timedOut: true,
          error: `Process timed out after ${timeoutMs}ms`,
        });
      }

      const success = code === 0;
      finish({
        success,
        exitCode: code,
        stdout: stdoutFinal,
        stderr: stderrFinal,
        excerpt,
        durationMs,
        timedOut: false,
        error: success
          ? undefined
          : `Process exited with code ${code}${signal ? ` (signal: ${signal})` : ""}`,
      });
    });
  });
}

/** Probes version information from an executable using non-interactive flag candidates. */
export async function probeVersion(
  executable: string,
  options: VersionProbeOptions = {},
): Promise<VersionProbeResult> {
  const candidates = options.candidateArgs ?? [["--version"], ["-v"], ["version"]];
  let lastResult: ProbeResult | undefined;

  for (const args of candidates) {
    const probeResult = await probeExecutable(executable, { ...options, args });
    lastResult = probeResult;

    const output = probeResult.stdout.trim() || probeResult.stderr.trim();
    const version = extractVersion(output);

    if (version !== undefined) {
      const ref = args.join(" ");
      const evidence: CapabilityEvidence = {
        source: "version",
        excerpt: boundExcerpt(version, options.maxOutputLength ?? DEFAULT_MAX_OUTPUT_LENGTH),
        capturedAt: new Date().toISOString(),
        reference: ref,
      };
      return {
        version,
        rawOutput: output,
        excerpt: evidence.excerpt,
        evidence,
        probeResult,
      };
    }
  }

  return {
    version: undefined,
    rawOutput: lastResult ? lastResult.stdout || lastResult.stderr : "",
    excerpt: lastResult ? lastResult.excerpt : "",
    evidence: undefined,
    probeResult: lastResult ?? {
      success: false,
      exitCode: null,
      stdout: "",
      stderr: "",
      excerpt: "",
      durationMs: 0,
      timedOut: false,
      error: "No version probe executed",
    },
  };
}

/** Probes help text and capability metadata from an executable using non-interactive flag candidates. */
export async function probeHelp(
  executable: string,
  options: HelpProbeOptions = {},
): Promise<HelpProbeResult> {
  const candidates = options.candidateArgs ?? [["--help"], ["-h"], ["help"]];
  let lastResult: ProbeResult | undefined;

  for (const args of candidates) {
    const probeResult = await probeExecutable(executable, { ...options, args });
    lastResult = probeResult;

    const output = probeResult.stdout.trim() || probeResult.stderr.trim();
    if (output.length > 0 && (probeResult.success || isHelpOutput(output))) {
      const ref = args.join(" ");
      const cleanHelp = boundExcerpt(output, options.maxOutputLength ?? DEFAULT_MAX_OUTPUT_LENGTH);
      const evidence: CapabilityEvidence = {
        source: "help",
        excerpt: cleanHelp,
        capturedAt: new Date().toISOString(),
        reference: ref,
      };
      return {
        helpText: cleanHelp,
        excerpt: cleanHelp,
        evidence,
        probeResult,
      };
    }
  }

  return {
    helpText: "",
    excerpt: lastResult ? lastResult.excerpt : "",
    evidence: undefined,
    probeResult: lastResult ?? {
      success: false,
      exitCode: null,
      stdout: "",
      stderr: "",
      excerpt: "",
      durationMs: 0,
      timedOut: false,
      error: "No help probe executed",
    },
  };
}

/** Probes both version and help metadata for an executable, returning consolidated harness metadata evidence. */
export async function probeHarnessMetadata(
  executable: string,
  options: HarnessMetadataProbeOptions = {},
): Promise<HarnessMetadataProbeResult> {
  const versionResult = await probeVersion(executable, {
    ...options,
    candidateArgs: options.versionCandidateArgs,
  });

  const helpResult = await probeHelp(executable, {
    ...options,
    candidateArgs: options.helpCandidateArgs,
  });

  const evidences: CapabilityEvidence[] = [];
  if (versionResult.evidence) {
    evidences.push(versionResult.evidence);
  }
  if (helpResult.evidence) {
    evidences.push(helpResult.evidence);
  }

  if (evidences.length === 0) {
    const errorMsg =
      versionResult.probeResult.error ||
      helpResult.probeResult.error ||
      "Failed to obtain version or help output";
    return {
      executable,
      version: undefined,
      helpText: undefined,
      evidences: [],
      status: "unavailable",
      diagnostic: errorMsg,
    };
  }

  // A successful process is not sufficient evidence that its output is
  // harness metadata. Keep malformed output distinct so callers do not
  // mistake an unrelated wrapper/banner for advertised capabilities.
  const helpOutput =
    helpResult.probeResult.stdout.trim() || helpResult.probeResult.stderr.trim();
  if (helpOutput.length > 0 && !isHelpOutput(helpOutput)) {
    return {
      executable,
      version: versionResult.version,
      helpText: undefined,
      evidences,
      status: "malformed",
      diagnostic: "Help probe returned output that was not recognized as CLI help",
    };
  }

  return {
    executable,
    version: versionResult.version,
    helpText: helpResult.helpText,
    evidences,
    status: "available",
  };
}
