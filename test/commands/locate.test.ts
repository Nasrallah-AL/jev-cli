import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { buildLocateRequest, locateFailed, runLocate, toPixels } from "../../src/core/locate.js";
import { cliHarness } from "../helpers/cli.js";
import { fakeAsk, yes } from "../helpers/fake-ask.js";
import { writePng } from "../helpers/png.js";

const boxAnswer = (
  confidence: number | null,
  edges = { top: 0.25, bottom: 0.82, left: 0.44, right: 0.84 },
) => ({
  type: "box",
  box: edges,
  confidence,
});
const IMG = { path: "k.png", format: "png", width: 400, height: 300, bytes: 1 };

describe("locate: core", () => {
  test("asks a box and a presence noul per target against one image", () => {
    const { state, questions } = buildLocateRequest({
      image: "IMG",
      targets: ["the mug", "the sink"],
      presence: true,
    });
    expect(state).toEqual({ image: "IMG" });
    expect(Object.keys(questions)).toEqual(["t1_present", "t1", "t2_present", "t2"]);
    expect(questions.t1).toEqual({ type: "box", instructions: "the mug in `image`" });
    const lean = buildLocateRequest({
      image: "IMG",
      targets: ["the mug"],
      presence: false,
      context: "a kitchen",
    });
    expect(Object.keys(lean.questions)).toEqual(["t1"]);
    expect(lean.state).toEqual({ image: "IMG", context: "a kitchen" });
    expect(() => buildLocateRequest({ image: "IMG", targets: [], presence: true })).toThrow(/at least one/);
    expect(() => buildLocateRequest({ image: "IMG", targets: ["a", "a"], presence: true })).toThrow(
      /distinct/,
    );
  });

  test("converts edges to pixels of the image as sent", () => {
    expect(toPixels({ top: 0.25, bottom: 0.82, left: 0.44, right: 0.84 }, 400, 300)).toEqual({
      x: 176,
      y: 75,
      width: 160,
      height: 171,
    });
  });

  test("marks targets found, low, or absent from presence and box confidence", async () => {
    const { ask } = fakeAsk({
      t1_present: yes(0.95),
      t1: boxAnswer(0.9),
      t2_present: yes(0.9),
      t2: boxAnswer(0.3),
      t3_present: yes(0.1),
      t3: boxAnswer(0.99, { top: -0.1, bottom: 1.2, left: 0, right: 1 }),
    });
    const out = await runLocate(
      ask,
      {
        image: "IMG",
        width: 400,
        height: 300,
        targets: ["mug", "spoon", "cat"],
        presentAt: 0.5,
        minConfidence: 0.5,
        presence: true,
      },
      IMG,
    );
    expect(out.results.map((r) => r.status)).toEqual(["found", "low", "absent"]);
    expect(out.results[0]).toMatchObject({ target: "mug", present: 0.95, confidence: 0.9 });
    expect(out.results[2]!.box).toEqual({ top: 0, bottom: 1, left: 0, right: 1 });
    expect(locateFailed(out, ["absent"])).toBe(true);
    expect(locateFailed(out, [])).toBe(false);
  });

  test("without the presence check every target is present; a null confidence is not low", async () => {
    const { ask } = fakeAsk({ t1: boxAnswer(null) });
    const out = await runLocate(
      ask,
      {
        image: "IMG",
        width: 400,
        height: 300,
        targets: ["mug"],
        presentAt: 0.5,
        minConfidence: 0.5,
        presence: false,
      },
      IMG,
    );
    expect(out.results[0]).toMatchObject({ status: "found", present: null, confidence: null });
  });
});

describe("locate: cli", () => {
  const h = cliHarness({ t1_present: yes(0.95), t2_present: yes(0.02) });

  test("uploads the image as a multipart file with the images header and prints pixel boxes", async () => {
    const img = writePng(h.dir(), "kitchen.png");
    const r = await h.run(["locate", img, "the coffee mug", "-t", "the cat", "--fail-on", "absent"]);
    expect(r.stderr).toBe("");
    expect(r.code).toBe(2);
    expect(r.stdout).toMatch(/the coffee mug\s+found\s+0\.95/);
    expect(r.stdout).toContain("176,75 160×171");
    expect(r.stdout).toMatch(/the cat\s+absent/);
    const req = h.api().requests[0]!;
    expect(req.headers["typesafe-danger-zone-images"]).toBe("true");
    expect(req.parts).toHaveLength(1);
    expect(req.parts![0]!.contentType).toMatch(/image\/png|octet-stream/);
    // biome-ignore lint/suspicious/noExplicitAny: inspecting the wire format
    const body = req.body as any;
    const ref = body.state.image as string;
    expect(body.assets[ref]).toMatchObject({ part: req.parts![0]!.name });
    expect(body.questions.t1).toEqual({ type: "box", instructions: "the coffee mug in `image`" });
  });

  test("--json carries image size, edges, and pixels; --pluck reaches into results", async () => {
    const img = writePng(h.dir(), "k.png");
    const r = await h.run(["locate", img, "the coffee mug", "--json"]);
    expect(r.code).toBe(0);
    const out = JSON.parse(r.stdout);
    expect(out.image).toMatchObject({ format: "png", width: 400, height: 300 });
    expect(out.results[0]).toMatchObject({ status: "found", pixels: { x: 176, y: 75 }, confidence: 0.92 });
    const p = await h.run(["locate", img, "the coffee mug", "--pluck", "results[0].pixels.x"]);
    expect(p.stdout.trim()).toBe("176");
  });

  test("--dry-run shows questions and the asset description without calling the API", async () => {
    const img = writePng(h.dir(), "k.png");
    const r = await h.run(["locate", img, "the mug", "--dry-run", "--no-presence"]);
    expect(r.code).toBe(0);
    const out = JSON.parse(r.stdout);
    expect(Object.keys(out.questions)).toEqual(["t1"]);
    expect(Object.values(out.assets)).toEqual([
      expect.objectContaining({ path: img, width: 400, height: 300 }),
    ]);
    expect(h.api().requests).toHaveLength(0);
  });

  test("rejects a missing target, a bad image, and proxy providers before any request", async () => {
    const img = writePng(h.dir(), "k.png");
    const none = await h.run(["locate", img]);
    expect(none.code).toBe(1);
    expect(none.stderr).toMatch(/Say what to find/);
    const tiny = writePng(h.dir(), "tiny.png", 100, 100);
    const small = await h.run(["locate", tiny, "x"]);
    expect(small.code).toBe(1);
    expect(small.stderr).toMatch(/100×100 px/);
    const proxied = await h.run(["locate", img, "x", "-P", "openrouter"], {
      env: { OPENROUTER_API_KEY: "sk-or-test" },
    });
    expect(proxied.code).toBe(1);
    expect(proxied.stderr).toMatch(/need the typesafe provider/);
    expect(h.api().requests).toHaveLength(0);
  });

  test("batch locate reads one image path per row with shared targets", async () => {
    const a = writePng(h.dir(), "a.png");
    const b = writePng(h.dir(), "b.png");
    const rows = join(h.dir(), "rows.txt");
    writeFileSync(rows, `${a}\n${b}\n`);
    const r = await h.run(["batch", "locate", "-i", `@${rows}`, "--", "-t", "the mug"]);
    expect(r.code).toBe(0);
    const lines = h.lines(r.stdout);
    expect(lines.map((l) => l.ok)).toEqual([true, true]);
    expect(lines[1].result.image.path).toBe(b);
  });
});
