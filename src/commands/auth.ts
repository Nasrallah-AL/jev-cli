import { createInterface } from "node:readline";
import { Writable } from "node:stream";
import type { Command } from "commander";
import type { CommandContext } from "../context.js";
import {
  CREDENTIAL_PROVIDERS,
  type CredentialProvider,
  ENV_VAR,
  resolveCredentials,
  resolveStore,
} from "../credentials.js";
import { CliError, EXIT } from "../errors.js";
import { readStdin } from "../input.js";
import { emit, paint } from "../output.js";
import { mask } from "./config.js";

function providerArg(raw: string | undefined): CredentialProvider {
  const p = (raw ?? "typesafe").toLowerCase();
  if (!(CREDENTIAL_PROVIDERS as readonly string[]).includes(p)) {
    throw new CliError(`Unknown provider "${raw}". Allowed: ${CREDENTIAL_PROVIDERS.join(", ")}.`);
  }
  return p as CredentialProvider;
}

/** Prompt for a secret with echo off. Falls back to reading one line from a pipe. */
export async function promptSecret(prompt: string): Promise<string> {
  if (!process.stdin.isTTY) return readStdin("API key").split(/\r?\n/)[0]?.trim() ?? "";
  const muted = new Writable({
    write(_chunk, _enc, cb) {
      cb();
    },
  });
  const rl = createInterface({ input: process.stdin, output: muted, terminal: true });
  process.stderr.write(prompt);
  return new Promise((resolve) => {
    rl.question("", (answer) => {
      rl.close();
      process.stderr.write("\n");
      resolve(answer.trim());
    });
  });
}

export function validateKey(provider: CredentialProvider, key: string): void {
  if (!key) throw new CliError("No key entered.");
  if (/\s/.test(key))
    throw new CliError("The key contains whitespace; paste it without spaces or line breaks.");
  if (provider === "openrouter" && !key.startsWith("sk-or-"))
    throw new CliError("OpenRouter keys start with sk-or-.");
}

export async function authLogin(
  providerName: string | undefined,
  flags: { keyStdin?: boolean },
  ctx: CommandContext,
  env = process.env,
): Promise<number> {
  const provider = providerArg(providerName);
  const store = resolveStore(env);
  const key = flags.keyStdin
    ? (readStdin("API key").split(/\r?\n/)[0]?.trim() ?? "")
    : await promptSecret(`Paste your ${provider} API key (input hidden): `);
  validateKey(provider, key);
  store.set(provider, key);
  const note = env[ENV_VAR[provider]]
    ? ` Note: ${ENV_VAR[provider]} is set in this shell and will take precedence until you unset it.`
    : "";
  emit(
    ctx.output,
    { command: "auth", action: "login", provider, store: store.kind, location: store.location },
    () => ({ head: [`Stored the ${provider} key in ${store.location}.${note}`] }),
  );
  return EXIT.OK;
}

export function authStatus(ctx: CommandContext, env = process.env): number {
  const store = resolveStore(env);
  const rows = resolveCredentials(env, store).map((c) => {
    const value = c.source === "env" ? env[ENV_VAR[c.provider]] : c.value;
    return { provider: c.provider, env_var: ENV_VAR[c.provider], source: c.source, key: mask(value) };
  });
  const payload = {
    command: "auth",
    action: "status",
    store: store.kind,
    location: store.location,
    credentials: rows,
  };
  emit(ctx.output, payload, () => {
    const c = ctx.output.color;
    return {
      table: {
        columns: ["Provider", "Source", "Key"],
        rows: rows.map(({ provider, source, key: masked }) => [
          provider,
          source === "none" ? paint(c, "dim", "none") : source,
          masked ?? paint(c, "dim", "-"),
        ]),
      },
      tail: [paint(c, "dim", `store: ${store.location}`)],
    };
  });
  return rows.some((r) => r.source !== "none") ? EXIT.OK : EXIT.ERROR;
}

export function authLogout(
  providerName: string | undefined,
  flags: { all?: boolean },
  ctx: CommandContext,
  env = process.env,
): number {
  const store = resolveStore(env);
  const providers = flags.all ? [...CREDENTIAL_PROVIDERS] : [providerArg(providerName)];
  const removed = providers.filter((p) => store.delete(p));
  emit(ctx.output, { command: "auth", action: "logout", removed, store: store.kind }, () => ({
    head: [
      removed.length
        ? `Removed ${removed.join(", ")} from ${store.location}.`
        : `Nothing stored for ${providers.join(", ")} in ${store.location}.`,
    ],
  }));
  return EXIT.OK;
}

export function registerAuth(
  program: Command,
  run: (fn: (ctx: CommandContext) => Promise<number>, cmd: Command) => Promise<void>,
) {
  const auth = program
    .command("auth")
    .description("Store the API key in the OS keychain (or a 0600 file) instead of exporting it.");

  auth
    .command("login")
    .description(
      "Prompt for a key (hidden input) and store it. Reads one line from stdin when piped or with --key-stdin.",
    )
    .argument("[provider]", "typesafe (default) or openrouter")
    .option("--key-stdin", "read the key from stdin (for scripts and password managers)")
    .addHelpText(
      "after",
      `
Examples:
  jev auth login
  op read "op://Private/TypeSafe/credential" | jev auth login --key-stdin
  jev auth login openrouter

Where it goes: macOS Keychain (service "jevctl"), Linux Secret Service via secret-tool, otherwise
~/.config/jev/credentials.json with mode 0600. Force one with JEV_CREDENTIAL_STORE=file|keychain.
Resolution order at run time: environment variable, then the store. JEV_NO_STORED_CREDENTIALS=1 disables the store.`,
    )
    .action(async (provider: string | undefined, flags: { keyStdin?: boolean }, cmd: Command) => {
      await run((ctx) => authLogin(provider, flags, ctx), cmd);
    });

  auth
    .command("status", { isDefault: true })
    .description("Show where each provider's key comes from (env, keychain, file, none), masked.")
    .action(async (_flags: unknown, cmd: Command) => {
      await run(async (ctx) => authStatus(ctx, process.env), cmd);
    });

  auth
    .command("logout")
    .description("Remove a stored key.")
    .argument("[provider]", "typesafe (default) or openrouter")
    .option("--all", "remove every stored key")
    .action(async (provider: string | undefined, flags: { all?: boolean }, cmd: Command) => {
      await run(async (ctx) => authLogout(provider, flags, ctx), cmd);
    });
}
