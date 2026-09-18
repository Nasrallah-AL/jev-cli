// Jev transport: TypeSafe direct (default), OpenRouter Decisions, or Cloudflare
// Workers AI. All speak the {state, questions} -> answers contract; URL, auth,
// and model slugs differ. Proxies add hops, so direct TypeSafe is the
// recommended default.

import { type Questions, TypeSafeClient } from "@typesafe-ai/sdk";
import type { ProviderName } from "./config.js";
import { CliError } from "./errors.js";

export type ResolvedProvider = Exclude<ProviderName, "auto">;

export interface Usage {
  input_tokens: number;
  output_tokens: number;
}

export interface AskResult {
  answers: Record<string, any>;
  usage: Usage;
  provider: ResolvedProvider;
  model: string;
}

/** The single dependency every command needs: ask Jev questions about state. */
export type AskFn = (state: unknown, questions: Record<string, unknown>) => Promise<AskResult>;

export interface ProviderOptions {
  provider: ProviderName;
  model: string;
  timeoutMs: number;
  env?: NodeJS.ProcessEnv;
  fetch?: typeof fetch;
  signal?: AbortSignal;
}

const USER_AGENT = "jevctl";
const REFERER = "https://github.com/Nasrallah-AL/jevctl";

/** OpenRouter has no `latest` alias; map it to the current pinned release. */
export const OPENROUTER_LATEST = "jev-1.13";

/** Decide which transport to use from explicit choice plus available credentials. */
export function resolveProvider(env: NodeJS.ProcessEnv, explicit: ProviderName = "auto"): ResolvedProvider {
  const hasTypesafe = Boolean(env.TYPESAFE_API_KEY?.trim());
  const hasOpenRouter = /^sk-or-/.test(env.OPENROUTER_API_KEY ?? "");
  const cfToken = env.JEV_CLOUDFLARE_API_TOKEN || env.CLOUDFLARE_API_TOKEN;
  const hasCloudflare = Boolean(cfToken && env.CLOUDFLARE_ACCOUNT_ID);

  switch (explicit) {
    case "typesafe":
      if (!hasTypesafe) throw new CliError("Provider is typesafe but TYPESAFE_API_KEY is not set.");
      return "typesafe";
    case "openrouter":
      if (!hasOpenRouter) {
        throw new CliError(
          "Provider is openrouter but OPENROUTER_API_KEY is not set or is not an sk-or- key.",
        );
      }
      return "openrouter";
    case "cloudflare":
      if (!hasCloudflare) {
        throw new CliError(
          "Provider is cloudflare but CLOUDFLARE_API_TOKEN (or JEV_CLOUDFLARE_API_TOKEN) and CLOUDFLARE_ACCOUNT_ID are not both set.",
        );
      }
      return "cloudflare";
    case "auto":
      if (hasTypesafe) return "typesafe";
      if (hasOpenRouter) return "openrouter";
      if (hasCloudflare) return "cloudflare";
      throw new CliError(
        "No credentials found. Set TYPESAFE_API_KEY (https://console.typesafe.ai/settings/keys), " +
          "OPENROUTER_API_KEY (sk-or-...), or CLOUDFLARE_API_TOKEN + CLOUDFLARE_ACCOUNT_ID.",
      );
    default: {
      const never: never = explicit;
      throw new CliError(`Unknown provider ${String(never)}`);
    }
  }
}

/** Model slug as each proxy expects it. */
export function providerModel(provider: ResolvedProvider, model: string): string {
  if (provider === "openrouter") {
    const effective = model === "jev-latest" ? OPENROUTER_LATEST : model;
    return effective.startsWith("typesafe/") ? effective : `typesafe/${effective}`;
  }
  if (provider === "cloudflare") {
    if (model.startsWith("typesafe/")) return model;
    return `typesafe/${model === "jev-latest" ? "jev" : model}`;
  }
  return model;
}

/** Build an `AskFn` bound to the resolved provider. */
export function createAsk(opts: ProviderOptions): AskFn {
  const env = opts.env ?? process.env;
  const provider = resolveProvider(env, opts.provider);
  const fetchImpl = opts.fetch ?? globalThis.fetch;
  const model = providerModel(provider, opts.model);

  if (provider === "typesafe") {
    const client = new TypeSafeClient({
      apiKey: env.TYPESAFE_API_KEY,
      baseURL: env.TYPESAFE_BASE_URL || undefined,
      defaultModel: model,
      timeout: opts.timeoutMs,
      fetch: fetchImpl as any,
      defaultHeaders: { "User-Agent": USER_AGENT },
    });
    return async (state, questions) => {
      const response = await client.systemOne(
        { state: state as any, questions: questions as Questions, model },
        { signal: opts.signal },
      );
      return {
        answers: response.answers as Record<string, any>,
        usage: {
          input_tokens: response.usage?.input_tokens ?? 0,
          output_tokens: response.usage?.output_tokens ?? 0,
        },
        provider,
        model: response.model ?? model,
      };
    };
  }

  if (provider === "openrouter") {
    return async (state, questions) => {
      const response = await fetchWithTimeout(
        fetchImpl,
        "https://openrouter.ai/api/alpha/decisions",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${env.OPENROUTER_API_KEY}`,
            "Content-Type": "application/json",
            "HTTP-Referer": REFERER,
            "X-Title": USER_AGENT,
          },
          body: JSON.stringify({ model, state, questions }),
        },
        opts.timeoutMs,
        opts.signal,
      );
      if (!response.ok) {
        const body = await response.text().catch(() => "");
        throw new CliError(`OpenRouter decisions API ${response.status}: ${body.slice(0, 300)}`);
      }
      const body = (await response.json()) as any;
      return {
        answers: body.answers ?? {},
        usage: { input_tokens: body.usage?.input_tokens ?? 0, output_tokens: body.usage?.output_tokens ?? 0 },
        provider,
        model: body.model ?? model,
      };
    };
  }

  // Cloudflare Workers AI wraps the same contract in {model, input} and the
  // v4 {result, success} envelope. Single alias; no version pinning.
  return async (state, questions) => {
    const response = await fetchWithTimeout(
      fetchImpl,
      `https://api.cloudflare.com/client/v4/accounts/${env.CLOUDFLARE_ACCOUNT_ID}/ai/run`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${env.JEV_CLOUDFLARE_API_TOKEN || env.CLOUDFLARE_API_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ model, input: { state, questions } }),
      },
      opts.timeoutMs,
      opts.signal,
    );
    const body = (await response.json().catch(() => ({}))) as any;
    if (!response.ok || body.success === false) {
      throw new CliError(
        `Cloudflare AI run ${response.status}: ${JSON.stringify(body.errors ?? body).slice(0, 300)}`,
      );
    }
    const outer = body.result;
    if (outer && typeof outer.state === "string" && outer.state !== "Completed") {
      throw new CliError(
        `Cloudflare AI run state ${outer.state}: ${JSON.stringify(body.errors ?? []).slice(0, 300)}`,
      );
    }
    const payload = outer?.result ?? outer ?? body;
    return {
      answers: payload.answers ?? {},
      usage: {
        input_tokens: payload.usage?.input_tokens ?? 0,
        output_tokens: payload.usage?.output_tokens ?? 0,
      },
      provider,
      model: payload.model ?? model,
    };
  };
}

async function fetchWithTimeout(
  fetchImpl: typeof fetch,
  url: string,
  init: RequestInit,
  timeoutMs: number,
  outer?: AbortSignal,
): Promise<Response> {
  const signals = [AbortSignal.timeout(timeoutMs)];
  if (outer) signals.push(outer);
  try {
    return await fetchImpl(url, { ...init, signal: AbortSignal.any(signals) });
  } catch (err) {
    if ((err as Error).name === "TimeoutError")
      throw new CliError(`Request timed out after ${timeoutMs} ms.`);
    throw err;
  }
}
