/** Process exit codes. Stable: scripts may depend on them. */
export const EXIT = {
  /** Command completed and no `--fail-on` condition matched. */
  OK: 0,
  /** Usage, configuration, input, or transport error. */
  ERROR: 1,
  /** Command completed; a `--fail-on` judgment condition matched. */
  JUDGMENT: 2,
} as const;

/** An error the CLI can present to the user without a stack trace. */
export class CliError extends Error {
  readonly exitCode: number;
  constructor(message: string, exitCode: number = EXIT.ERROR) {
    super(message);
    this.name = "CliError";
    this.exitCode = exitCode;
  }
}

/** Reduce an unknown thrown value to a printable message, with a next step for known API failures. */
export function describeError(err: unknown): string {
  if (err instanceof Error) {
    const status = (err as { status?: number }).status;
    const extra = status ? ` (HTTP ${status})` : "";
    const hint = apiHint(status, err);
    return `${err.message}${extra}${hint ? `\n  hint: ${hint}` : ""}`;
  }
  return String(err);
}

function apiHint(status: number | undefined, err: Error): string | null {
  if (!status) return null;
  let body = "";
  try {
    body = `${err.message} ${JSON.stringify((err as { body?: unknown }).body ?? "")}`;
  } catch {
    body = err.message;
  }
  if (/max_tokens_exceeded/.test(body)) {
    return "the request is longer than the model's context (64k per request, 32k per question). Send less, or pass --long-context to allow up to 262k tokens.";
  }
  if (status === 401) return "the API key was rejected. Run `jev auth login` or check TYPESAFE_API_KEY.";
  if (status === 413) {
    return "the request is over a size limit (32 MiB body, 16 MiB per image, or the expanded request). Send fewer or smaller images.";
  }
  if (status === 429) return "rate limited after retries. Lower batch --concurrency or wait and retry.";
  if (status === 529) return "TypeSafe is overloaded. Retry shortly.";
  return null;
}
