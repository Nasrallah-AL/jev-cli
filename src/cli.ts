#!/usr/bin/env node
// jev: TypeSafe's Jev model at the command line.

import { createRequire } from "node:module";
import { Command } from "commander";
import { registerAsk } from "./commands/ask.js";
import { registerAuth } from "./commands/auth.js";
import { registerBatch } from "./commands/batch.js";
import { registerClassify } from "./commands/classify.js";
import { registerCompact } from "./commands/compact.js";
import { registerConfig } from "./commands/config.js";
import { registerExtract } from "./commands/extract.js";
import { registerFind } from "./commands/find.js";
import { registerMatch } from "./commands/match.js";
import { registerModels } from "./commands/models.js";
import { registerRerank } from "./commands/rerank.js";
import { registerRoute } from "./commands/route.js";
import { registerScreen } from "./commands/screen.js";
import { registerVerify } from "./commands/verify.js";
import { buildContext, type CommandContext, type GlobalFlags } from "./context.js";
import { CliError, describeError, EXIT } from "./errors.js";

const require = createRequire(import.meta.url);
const { version, description } = require("../package.json") as { version: string; description: string };

export function createProgram(): Command {
  const program = new Command();
  program
    .name("jev")
    .description(description)
    .version(version, "-V, --version", "print the version")
    .showHelpAfterError("(run with --help for usage)")
    .showSuggestionAfterError()
    .option("--json", "print results as JSON (same as --format json)")
    .option("--format <fmt>", "output format: text, json, jsonl, csv, tsv, or md")
    .option("--md", "Markdown output (same as --format md)")
    .option("--pluck <path>", "print one value from the JSON result, e.g. label or results[].verdict")
    .option("-m, --model <name>", "Jev model, e.g. jev-latest or jev-1.13.0")
    .option("-P, --provider <name>", "auto, typesafe, openrouter, or cloudflare")
    .option("--timeout <ms>", "per-request timeout in milliseconds")
    .option("--no-color", "disable colored output")
    .option("-q, --quiet", "omit the usage/model footer in text output")
    .option("--dry-run", "print the request that would be sent and exit without calling the API")
    .addHelpText(
      "after",
      `
Exit codes:
  0  success
  1  usage, configuration, input, or transport error
  2  a --fail-on judgment condition matched (e.g. a contradicted claim)

Credentials (first found wins unless --provider is set; environment first, then the jev auth login store):
  TYPESAFE_API_KEY                                https://console.typesafe.ai/settings/keys
  OPENROUTER_API_KEY (sk-or-...)                  OpenRouter Decisions API
  CLOUDFLARE_API_TOKEN + CLOUDFLARE_ACCOUNT_ID    Cloudflare Workers AI

Docs: https://docs.typesafe.ai`,
    );

  const run = async (fn: (ctx: CommandContext) => Promise<number>, cmd: Command) => {
    const flags = cmd.optsWithGlobals<GlobalFlags>();
    const ctx = buildContext(flags);
    const code = await fn(ctx);
    if (code !== EXIT.OK) process.exitCode = code;
  };

  registerVerify(program, run);
  registerScreen(program, run);
  registerFind(program, run);
  registerAsk(program, run);
  registerClassify(program, run);
  registerExtract(program, run);
  registerRerank(program, run);
  registerMatch(program, run);
  registerRoute(program, run);
  registerCompact(program, run);
  registerBatch(program, run);
  registerModels(program, run);
  registerAuth(program, run);
  registerConfig(program, run);
  return program;
}

export async function main(argv: string[] = process.argv): Promise<void> {
  const program = createProgram();
  try {
    await program.parseAsync(argv);
  } catch (err) {
    const debug = process.env.JEV_DEBUG === "1";
    if (err instanceof CliError) {
      process.stderr.write(`jev: ${err.message}\n`);
      process.exitCode = err.exitCode;
    } else {
      process.stderr.write(`jev: ${describeError(err)}\n`);
      process.exitCode = EXIT.ERROR;
    }
    if (debug && err instanceof Error && err.stack) process.stderr.write(`${err.stack}\n`);
  }
}

await main();
