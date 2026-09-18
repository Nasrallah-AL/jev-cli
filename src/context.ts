import { type JevConfig, type PartialConfig, PROVIDERS, type ProviderName, resolveConfig } from "./config.js";
import { withStoredCredentials } from "./credentials.js";
import { CliError } from "./errors.js";
import { type OutputOptions, shouldColor } from "./output.js";
import { type AskFn, createAsk } from "./provider.js";

/** Global flags shared by every command (declared on the root program). */
export interface GlobalFlags {
  json?: boolean;
  format?: string;
  model?: string;
  provider?: string;
  timeout?: string;
  color?: boolean;
  quiet?: boolean;
  dryRun?: boolean;
}

export interface CommandContext {
  config: JevConfig;
  /** Environment with stored credentials filled in where the shell had none. */
  env: NodeJS.ProcessEnv;
  output: OutputOptions;
  dryRun: boolean;
  /** Lazily build the provider; commands that never call Jev (dry-run, config) avoid needing credentials. */
  ask: () => AskFn;
}

export interface ContextOptions {
  env?: NodeJS.ProcessEnv;
  useFile?: boolean;
  askFactory?: (config: JevConfig, env: NodeJS.ProcessEnv) => AskFn;
  stream?: NodeJS.WritableStream;
}

export function flagsToConfig(flags: GlobalFlags): PartialConfig {
  const out: Record<string, unknown> = {};
  if (flags.model) out.model = flags.model;
  if (flags.provider) {
    const p = flags.provider.toLowerCase();
    if (!(PROVIDERS as readonly string[]).includes(p)) {
      throw new CliError(`Unknown provider "${flags.provider}". Allowed: ${PROVIDERS.join(", ")}.`);
    }
    out.provider = p as ProviderName;
  }
  if (flags.timeout !== undefined) {
    const n = Number(flags.timeout);
    if (!Number.isFinite(n) || n <= 0)
      throw new CliError("--timeout must be a positive number of milliseconds.");
    out.timeoutMs = n;
  }
  if (flags.json) out.format = "json";
  else if (flags.format) {
    if (flags.format !== "json" && flags.format !== "text") {
      throw new CliError(`Unknown format "${flags.format}". Allowed: text, json.`);
    }
    out.format = flags.format;
  }
  return out as PartialConfig;
}

export function buildContext(flags: GlobalFlags, opts: ContextOptions = {}): CommandContext {
  const env = withStoredCredentials(opts.env ?? process.env);
  const config = resolveConfig({ env, flags: flagsToConfig(flags), useFile: opts.useFile });
  const output: OutputOptions = {
    format: config.format,
    color: flags.color === false ? false : shouldColor(env),
    quiet: Boolean(flags.quiet),
    stream: opts.stream,
  };
  let cached: AskFn | undefined;
  const factory =
    opts.askFactory ??
    ((cfg: JevConfig, e: NodeJS.ProcessEnv) =>
      createAsk({ provider: cfg.provider, model: cfg.model, timeoutMs: cfg.timeoutMs, env: e }));
  return {
    config,
    env,
    output,
    dryRun: Boolean(flags.dryRun),
    ask: () => {
      cached ??= factory(config, env);
      return cached;
    },
  };
}
