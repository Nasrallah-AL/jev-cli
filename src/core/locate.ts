// Locate: where is each target in an image? One Box question per target, plus
// a companion Noul per target asking whether it is there at all, because a Box
// always answers with four edges, even for something absent
// (https://docs.typesafe.ai/primitives/box#writing-box-questions).
// All questions go in one request against the same image.

import { box, noul } from "@typesafe-ai/sdk";
import type { AskFn, Usage } from "../provider.js";

export interface BoxEdges {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

export interface LocateInput {
  /** The image asset (SDK `Image`); placed in state as `image`. */
  image: unknown;
  width: number;
  height: number;
  targets: string[];
  /** Optional text about the image, sent alongside it in the state. */
  context?: string;
  /** Presence probability at or above which a target counts as present. */
  presentAt: number;
  /** Box confidence below which a present target is reported as `low`. */
  minConfidence: number;
  /** Skip the presence Noul (cheaper; every target is assumed present). */
  presence: boolean;
}

export type LocateStatus = "found" | "low" | "absent";

export interface LocateResult {
  target: string;
  status: LocateStatus;
  /** Probability the target is in the image; null when presence was skipped. */
  present: number | null;
  confidence: number | null;
  /** Edges as fractions of the image (0 top/left to 1 bottom/right). */
  box: BoxEdges;
  /** The same box in pixels of the image as sent. */
  pixels: { x: number; y: number; width: number; height: number };
}

export interface LocateOutput {
  command: "locate";
  model: string;
  provider: string;
  image: { path: string; format: string; width: number; height: number; bytes: number };
  results: LocateResult[];
  thresholds: { present_at: number; min_confidence: number };
  usage: Usage;
}

export function buildLocateRequest(input: Pick<LocateInput, "image" | "targets" | "context" | "presence">) {
  const targets = input.targets.map((t) => t.trim());
  if (targets.length === 0) throw new Error("Give at least one target to locate.");
  if (targets.some((t) => t.length === 0)) throw new Error("Targets must not be empty.");
  if (new Set(targets).size !== targets.length) throw new Error("Targets must be distinct.");

  const questions: Record<string, unknown> = {};
  targets.forEach((target, i) => {
    const id = `t${i + 1}`;
    if (input.presence) {
      questions[`${id}_present`] = noul(`Is this visible in \`image\`: ${target}?`, {
        true: "It is clearly in the image, even if small or partly hidden",
        false: "It is not in the image, or nothing in the image matches the description",
      });
    }
    questions[id] = box(`${target} in \`image\``);
  });
  const state = input.context ? { image: input.image, context: input.context } : { image: input.image };
  return { state, questions, targets };
}

export function toPixels(b: BoxEdges, width: number, height: number) {
  const x = Math.round(b.left * width);
  const y = Math.round(b.top * height);
  return {
    x,
    y,
    width: Math.max(0, Math.round(b.right * width) - x),
    height: Math.max(0, Math.round(b.bottom * height) - y),
  };
}

export async function runLocate(
  ask: AskFn,
  input: LocateInput,
  image: LocateOutput["image"],
): Promise<LocateOutput> {
  const { state, questions, targets } = buildLocateRequest(input);
  const { answers, usage, provider, model } = await ask(state, questions);

  const results = targets.map((target, i): LocateResult => {
    const id = `t${i + 1}`;
    const a = answers[id];
    const edges: BoxEdges = {
      top: clamp(a.box.top),
      bottom: clamp(a.box.bottom),
      left: clamp(a.box.left),
      right: clamp(a.box.right),
    };
    const present: number | null = input.presence ? answers[`${id}_present`].noul : null;
    const confidence: number | null = typeof a.confidence === "number" ? a.confidence : null;
    const status: LocateStatus =
      present !== null && present < input.presentAt
        ? "absent"
        : confidence !== null && confidence < input.minConfidence
          ? "low"
          : "found";
    return {
      target,
      status,
      present,
      confidence,
      box: edges,
      pixels: toPixels(edges, input.width, input.height),
    };
  });

  return {
    command: "locate",
    model,
    provider,
    image,
    results,
    thresholds: { present_at: input.presentAt, min_confidence: input.minConfidence },
    usage,
  };
}

export const LOCATE_FAIL_CONDITIONS = ["absent", "low"] as const;
export type LocateFailCondition = (typeof LOCATE_FAIL_CONDITIONS)[number];

export function locateFailed(output: LocateOutput, conditions: readonly LocateFailCondition[]): boolean {
  return output.results.some((r) => (conditions as readonly string[]).includes(r.status));
}

function clamp(n: number): number {
  return Math.min(1, Math.max(0, n));
}
