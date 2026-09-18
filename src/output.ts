import { stripVTControlCharacters, styleText } from "node:util";

export type Format = "text" | "json";

export interface OutputOptions {
  format: Format;
  color: boolean;
  quiet: boolean;
  stream?: NodeJS.WritableStream;
}

/** Decide whether to colorize, honoring NO_COLOR, FORCE_COLOR, and TTY. */
export function shouldColor(env: NodeJS.ProcessEnv = process.env, isTTY = process.stdout.isTTY): boolean {
  if (env.NO_COLOR !== undefined && env.NO_COLOR !== "") return false;
  if (env.FORCE_COLOR !== undefined && env.FORCE_COLOR !== "0") return true;
  return Boolean(isTTY);
}

type Style = Parameters<typeof styleText>[0];

export function paint(enabled: boolean, style: Style, text: string): string {
  return enabled ? styleText(style, text) : text;
}

export function formatProbability(p: number | null | undefined): string {
  if (p === null || p === undefined || Number.isNaN(p)) return "-";
  return p.toFixed(2);
}

/** Render rows as a padded table. First row is the header. */
export function table(rows: string[][], opts: { color?: boolean } = {}): string {
  if (rows.length === 0) return "";
  const widths: number[] = [];
  for (const row of rows) {
    row.forEach((cell, i) => {
      widths[i] = Math.max(widths[i] ?? 0, visibleLength(cell));
    });
  }
  const render = (row: string[]) =>
    row
      .map((cell, i) => cell + " ".repeat((widths[i] ?? 0) - visibleLength(cell)))
      .join("  ")
      .trimEnd();
  const [header, ...body] = rows;
  const lines = [paint(opts.color ?? false, "bold", render(header!))];
  lines.push(widths.map((w) => "-".repeat(w)).join("  "));
  for (const row of body) lines.push(render(row));
  return lines.join("\n");
}

function visibleLength(s: string): number {
  return stripVTControlCharacters(s).length;
}

/** Clip a string for table display. */
export function clip(text: string, max = 60): string {
  const oneLine = text.replace(/\s+/g, " ").trim();
  return oneLine.length <= max ? oneLine : `${oneLine.slice(0, max - 1)}…`;
}

export function usageLine(
  usage: { input_tokens: number; output_tokens: number },
  model: string,
  provider: string,
) {
  return `${usage.input_tokens} in / ${usage.output_tokens} out tokens · ${model} via ${provider}`;
}

/** Write a result either as JSON or via the provided text renderer. */
export function emit(opts: OutputOptions, payload: unknown, renderText: () => string): void {
  const stream = opts.stream ?? process.stdout;
  if (opts.format === "json") {
    stream.write(`${JSON.stringify(payload, null, 2)}\n`);
    return;
  }
  stream.write(`${renderText()}\n`);
}
