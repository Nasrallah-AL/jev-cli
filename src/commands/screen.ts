import type { Command } from "commander";
import type { CommandContext } from "../context.js";
import {
  buildScreenRequest,
  runScreen,
  SCREEN_FAIL_CONDITIONS,
  type ScreenOutput,
  screenFailed,
} from "../core/screen.js";
import { CliError, EXIT } from "../errors.js";
import { readInput, readStdin } from "../input.js";
import { parseFailOn, parseProbability } from "../lib.js";
import { emit, formatProbability, paint, usageLine } from "../output.js";

export interface ScreenFlags {
  purpose?: string;
  blockAt?: string;
  reviewAt?: string;
  failOn?: string;
}

export function resolveScreenText(positional: string | undefined): string {
  if (positional !== undefined) return readInput(positional, "text");
  if (process.stdin.isTTY) throw new CliError("Provide text as an argument, @file, or pipe it on stdin.");
  return readStdin("text");
}

export async function screenAction(
  positional: string | undefined,
  flags: ScreenFlags,
  ctx: CommandContext,
): Promise<number> {
  const text = resolveScreenText(positional);
  const blockAt = parseProbability("--block-at", flags.blockAt, ctx.config.screen.blockAt);
  const reviewAt = parseProbability("--review-at", flags.reviewAt, ctx.config.screen.reviewAt);
  const failOn = parseFailOn(flags.failOn, SCREEN_FAIL_CONDITIONS, ["block"]);

  if (ctx.dryRun) {
    const { state, questions } = buildScreenRequest({ text, purpose: flags.purpose });
    emit({ ...ctx.output, format: "json" }, { model: ctx.config.model, state, questions }, () => "");
    return EXIT.OK;
  }

  const output = await runScreen(ctx.ask(), { text, purpose: flags.purpose, blockAt, reviewAt });
  emit(ctx.output, output, () => renderScreen(output, ctx));
  return screenFailed(output, failOn) ? EXIT.JUDGMENT : EXIT.OK;
}

export function renderScreen(out: ScreenOutput, ctx: CommandContext): string {
  const c = ctx.output.color;
  const action = out.recommendation.action;
  const styled =
    action === "block"
      ? paint(c, ["bold", "red"], action.toUpperCase())
      : action === "review"
        ? paint(c, ["bold", "yellow"], action.toUpperCase())
        : action === "skip"
          ? paint(c, ["bold", "dim"], action.toUpperCase())
          : paint(c, ["bold", "green"], action.toUpperCase());
  const p = out.probabilities;
  const lines = [
    `${styled}  ${out.recommendation.reason}`,
    `injection ${formatProbability(p.injection)} · substance ${formatProbability(p.substance)} · relevance ${formatProbability(p.relevance)}`,
    paint(c, "dim", `thresholds: block ≥ ${out.thresholds.block_at}, review ≥ ${out.thresholds.review_at}`),
  ];
  if (!ctx.output.quiet) lines.push(paint(c, "dim", usageLine(out.usage, out.model, out.provider)));
  return lines.join("\n");
}

export function registerScreen(
  program: Command,
  run: (fn: (ctx: CommandContext) => Promise<number>, cmd: Command) => Promise<void>,
) {
  program
    .command("screen")
    .description("Screen text for prompt injection, substance, and relevance before an agent reads it.")
    .argument("[text]", "text to screen, @file, or - for stdin (default: stdin)")
    .option(
      "-p, --purpose <text>",
      "what the consuming agent is trying to do; enables the relevance check and 'skip'",
    )
    .option("--block-at <p>", "injection probability at or above which to block (default 0.75)")
    .option("--review-at <p>", "injection probability at or above which to flag for review (default 0.25)")
    .option(
      "--fail-on <list>",
      `exit 2 when the recommendation is one of: ${SCREEN_FAIL_CONDITIONS.join(", ")}, none (default block)`,
    )
    .addHelpText(
      "after",
      `
Examples:
  curl -s https://example.com/pricing | jev screen --purpose "extract pricing tiers"
  jev screen @email.txt --fail-on block,review && cat email.txt`,
    )
    .action(async (text: string | undefined, flags: ScreenFlags, cmd: Command) => {
      await run((ctx) => screenAction(text, flags, ctx), cmd);
    });
}
