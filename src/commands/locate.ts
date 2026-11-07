import type { Command } from "commander";
import type { CommandContext } from "../context.js";
import type { BatchItemRunner } from "../core/batch.js";
import {
  buildLocateRequest,
  LOCATE_FAIL_CONDITIONS,
  type LocateOutput,
  locateFailed,
  runLocate,
} from "../core/locate.js";
import { CliError, EXIT } from "../errors.js";
import { describeImage, dryRunAssets, type LoadedImage, loadImage } from "../image.js";
import { readInput } from "../input.js";
import { parseFailOn, parseProbability } from "../lib.js";
import { emit, formatProbability, paint, type View } from "../output.js";

export interface LocateFlags {
  target?: string[];
  context?: string;
  presentAt?: string;
  minConfidence?: string;
  presence?: boolean;
  failOn?: string;
}

interface Resolved {
  targets: string[];
  context?: string;
  presentAt: number;
  minConfidence: number;
  presence: boolean;
  failOn: (typeof LOCATE_FAIL_CONDITIONS)[number][];
}

function resolveLocateFlags(positionalTargets: string[], flags: LocateFlags, ctx: CommandContext): Resolved {
  const targets = [...positionalTargets, ...(flags.target ?? [])].map((t) => t.trim()).filter(Boolean);
  try {
    return {
      targets,
      context: flags.context === undefined ? undefined : readInput(flags.context, "context"),
      presentAt: parseProbability("--present-at", flags.presentAt, ctx.config.locate.presentAt),
      minConfidence: parseProbability(
        "--min-confidence",
        flags.minConfidence,
        ctx.config.locate.minConfidence,
      ),
      presence: flags.presence !== false,
      failOn: parseFailOn(flags.failOn, LOCATE_FAIL_CONDITIONS, []),
    };
  } catch (err) {
    if (err instanceof CliError) throw err;
    throw new CliError((err as Error).message);
  }
}

async function locateOne(img: LoadedImage, r: Resolved, ctx: CommandContext): Promise<LocateOutput> {
  return runLocate(
    ctx.ask(),
    {
      image: img.asset,
      width: img.width,
      height: img.height,
      targets: r.targets,
      context: r.context,
      presentAt: r.presentAt,
      minConfidence: r.minConfidence,
      presence: r.presence,
    },
    describeImage(img),
  );
}

export async function locateAction(
  imagePath: string,
  positionalTargets: string[],
  flags: LocateFlags,
  ctx: CommandContext,
): Promise<number> {
  const r = resolveLocateFlags(positionalTargets, flags, ctx);
  if (r.targets.length === 0) {
    throw new CliError('Say what to find: jev locate photo.jpg "the coffee mug" (or -t, repeatable).');
  }
  const img = loadImage(imagePath);

  if (ctx.dryRun) {
    const { state, questions } = buildLocateRequest({
      image: img.asset,
      targets: r.targets,
      context: r.context,
      presence: r.presence,
    });
    emit(
      { ...ctx.output, format: "json" },
      { model: ctx.config.model, state, questions, assets: dryRunAssets([img]) },
      () => ({}),
    );
    return EXIT.OK;
  }

  const output = await locateOne(img, r, ctx);
  emit(ctx.output, output, () => renderLocate(output, ctx));
  return locateFailed(output, r.failOn) ? EXIT.JUDGMENT : EXIT.OK;
}

export function renderLocate(out: LocateOutput, ctx: CommandContext): View {
  const c = ctx.output.color;
  const status = (s: string) =>
    s === "found" ? paint(c, "green", s) : s === "low" ? paint(c, "yellow", s) : paint(c, "red", s);
  return {
    head: [paint(c, "dim", `${out.image.path} (${out.image.width}×${out.image.height})`)],
    table: {
      columns: ["Target", "Status", "Present", "Conf", "Box px (x,y w×h)", "Edges (l,t,r,b)"],
      rows: out.results.map((r) => [
        r.target,
        status(r.status),
        formatProbability(r.present),
        formatProbability(r.confidence),
        `${r.pixels.x},${r.pixels.y} ${r.pixels.width}×${r.pixels.height}`,
        [r.box.left, r.box.top, r.box.right, r.box.bottom].map((n) => n.toFixed(3)).join(","),
      ]),
    },
    usage: { usage: out.usage, model: out.model, provider: out.provider },
  };
}

export function registerLocate(
  program: Command,
  run: (fn: (ctx: CommandContext) => Promise<number>, cmd: Command) => Promise<void>,
) {
  program
    .command("locate")
    .description(
      "Find where things are in an image: a bounding box per target, plus the probability it is there at all. " +
        "Needs Jev 1.14 and TypeSafe direct; images are an experimental TypeSafe feature.",
    )
    .argument("<image>", "PNG or JPEG file, 280 to 1568 px per side")
    .argument("[targets...]", 'what to find, e.g. "the coffee mug" (one box per target)')
    .option("-t, --target <text>", "what to find (repeatable; adds to positional targets)", collect, [])
    .option("-c, --context <text>", "text about the image sent with it (@file allowed)")
    .option(
      "--present-at <p>",
      "presence probability at or above which a target counts as there (default 0.5)",
    )
    .option("--min-confidence <p>", "box confidence below which a found target is 'low' (default 0.5)")
    .option("--no-presence", "skip the is-it-there check (cheaper; a box always comes back)")
    .option(
      "--fail-on <list>",
      `exit 2 when any target is: ${LOCATE_FAIL_CONDITIONS.join(", ")}, none (default none)`,
    )
    .addHelpText(
      "after",
      `
Examples:
  jev locate kitchen.jpg "the coffee mug"
  jev locate form.png -t "the signature" -t "the date field" --json
  jev locate shot.png "the Submit button" --fail-on absent --pluck results[0].pixels
  jev batch locate -i @frames.txt -- -t "a bird at the feeder" --fail-on absent`,
    )
    .action(async (image: string, targets: string[], flags: LocateFlags, cmd: Command) => {
      await run((ctx) => locateAction(image, targets, flags, ctx), cmd);
    });
}

function collect(value: string, previous: string[]): string[] {
  return [...previous, value];
}

/** Batch: each row is an image path; targets are shared via -t. */
export function prepareLocateBatch(flags: LocateFlags, ctx: CommandContext): BatchItemRunner {
  const r = resolveLocateFlags([], flags, ctx);
  if (r.targets.length === 0) throw new CliError("Batched locate needs targets via -t/--target.");
  return async (row) => {
    const output = await locateOne(loadImage(row.text.trim(), `row ${row.id} image`), r, ctx);
    return { output, failed: locateFailed(output, r.failOn) };
  };
}
