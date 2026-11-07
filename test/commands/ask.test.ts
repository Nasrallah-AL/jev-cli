import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import {
  parseQuestions,
  questionsFromFlags,
  runAsk,
  splitOptions,
  splitShorthand,
} from "../../src/core/ask.js";
import { cliHarness } from "../helpers/cli.js";
import { fakeAsk, yes } from "../helpers/fake-ask.js";

import { writePng } from "../helpers/png.js";

describe("ask: core", () => {
  test("splitShorthand and splitOptions", () => {
    expect(splitShorthand("urgent=Is it urgent?", "q1")).toEqual({
      id: "urgent",
      instructions: "Is it urgent?",
    });
    expect(splitShorthand("Is it urgent?", "q1")).toEqual({ id: "q1", instructions: "Is it urgent?" });
    expect(() => splitShorthand("bad id=x", "q1")).toThrow(/Question id/);
    expect(splitOptions("Which team?|billing:refunds and invoices,tech,sales:new accounts")).toEqual({
      instructions: "Which team?",
      options: [
        { label: "billing", description: "refunds and invoices" },
        { label: "tech", description: null },
        { label: "sales", description: "new accounts" },
      ],
    });
    expect(splitOptions("A \\| B?|x,y\\,z").options.map((o) => o.label)).toEqual(["x", "y,z"]);
    expect(() => splitOptions("no options")).toThrow(/Missing options/);
  });

  test("questionsFromFlags rejects a question id used twice", () => {
    expect(() => questionsFromFlags({ noul: ["a=q1", "a=q2"] })).toThrow(/"a" is used twice/);
  });

  test("questionsFromFlags builds all three primitives", () => {
    const q = questionsFromFlags({
      noul: ["urgent=Is it urgent?"],
      choice: ["team=Which team?|billing:refunds,tech"],
      score: ["tone=How harsh?|gentle,direct,harsh:hostile"],
    });
    expect(q.urgent).toEqual({ type: "noul", instructions: "Is it urgent?" });
    expect(q.team).toEqual({
      type: "choice",
      instructions: "Which team?",
      criteria: { billing: "refunds", tech: null },
    });
    expect(q.tone).toEqual({
      type: "score",
      instructions: "How harsh?",
      criteria: ["gentle", "direct", "harsh: hostile"],
    });
    expect(() => questionsFromFlags({ choice: ["x=Q?|only"] })).toThrow(/at least two options/);
    expect(() => questionsFromFlags({})).toThrow(/At least one question/);
  });

  test("parseQuestions validates the API shape", () => {
    expect(parseQuestions({ a: { type: "noul", instructions: "x" } })).toBeTruthy();
    expect(() => parseQuestions({ a: { type: "score", criteria: ["one"] } })).toThrow(/Invalid questions/);
    expect(() => parseQuestions({ a: { type: "bogus" } })).toThrow(/Invalid questions/);
  });

  test("runAsk passes state and questions straight through", async () => {
    const { ask, calls } = fakeAsk({ a: yes(0.5) });
    const questions = parseQuestions({ a: { type: "noul", instructions: "x" } });
    const out = await runAsk(ask, { state: { k: 1 }, questions });
    expect(calls[0]).toEqual({ state: { k: 1 }, questions });
    expect(out.answers).toEqual({ a: yes(0.5) });
    expect(out.model).toBe("jev-1.13.0");
  });
});

describe("ask: cli", () => {
  const h = cliHarness();

  test("shorthand flags produce typed answers in text mode", async () => {
    const r = await h.run([
      "ask",
      "I was charged twice",
      "--noul",
      "urgent=Is it urgent?",
      "--choice",
      "team=Which team?|billing:refunds,tech",
      "--score",
      "tone=Tone?|calm,angry",
    ]);
    expect(r.code).toBe(0);
    expect(r.stdout).toMatch(/urgent: 0\.05/);
    expect(r.stdout).toMatch(/team: billing\s+conf 0\.88/);
    expect(r.stdout).toMatch(/tone: 0\.70/);
  });

  test("--questions JSON with --state-json passes structured state through", async () => {
    const q = join(h.dir(), "q.json");
    writeFileSync(q, JSON.stringify({ ok: { type: "noul", instructions: "Is it ok?" } }));
    const r = await h.run(["ask", "--state-json", "--questions", `@${q}`, "--json"], { stdin: '{"a":1}' });
    expect(r.code).toBe(0);
    expect(JSON.parse(r.stdout).answers.ok.noul).toBe(0.05);
    expect(h.api().requests[0]!.body).toMatchObject({ state: { a: 1 } });
  });

  test("-Q is reachable: the short form of --questions survives the root option table", async () => {
    const q = join(h.dir(), "q.json");
    writeFileSync(q, JSON.stringify({ ok: { type: "noul", instructions: "Is it ok?" } }));
    const r = await h.run(["ask", "I was charged twice", "-Q", `@${q}`, "--json"]);
    expect(r.code).toBe(0);
    expect(JSON.parse(r.stdout).answers.ok.noul).toBe(0.05);
  });

  test("mixing --questions and shorthands, or providing neither, is an error", async () => {
    const both = await h.run(["ask", "s", "--questions", "@x.json", "--noul", "a=b"]);
    expect(both.code).toBe(1);
    expect(both.stderr).toMatch(/not both/);
    const neither = await h.run(["ask", "s"]);
    expect(neither.code).toBe(1);
    expect(neither.stderr).toMatch(/Provide questions/);
  });
});

describe("ask: images and box", () => {
  const h = cliHarness();

  test("--box shorthand builds a box question", () => {
    expect(questionsFromFlags({ box: ["mug=the mug in `image`"] })).toEqual({
      mug: { type: "box", instructions: "the mug in `image`" },
    });
    expect(() => questionsFromFlags({ box: ["mug="] })).toThrow(/needs instructions/);
    expect(parseQuestions({ b: { type: "box", instructions: "x" } })).toEqual({
      b: { type: "box", instructions: "x" },
    });
  });

  test("--image adds named images to text state and sends them as file parts", async () => {
    const img = writePng(h.dir(), "door.png");
    const r = await h.run([
      "ask",
      "Front door camera",
      "--image",
      `door=${img}`,
      "--noul",
      "person=Is there a person in `door`?",
      "--box",
      "where=the person in `door`",
      "--json",
    ]);
    expect(r.stderr).toBe("");
    expect(r.code).toBe(0);
    const out = JSON.parse(r.stdout);
    expect(out.answers.where).toMatchObject({ type: "box", confidence: 0.92 });
    const req = h.api().requests[0]!;
    expect(req.headers["typesafe-danger-zone-images"]).toBe("true");
    // biome-ignore lint/suspicious/noExplicitAny: inspecting the wire format
    const body = req.body as any;
    expect(body.state.text).toBe("Front door camera");
    expect(body.assets[body.state.door]).toMatchObject({ part: req.parts![0]!.name });
  });

  test("--image needs no text state; text output shows box edges", async () => {
    const img = writePng(h.dir(), "p.png");
    const r = await h.run(["ask", "--image", img, "--box", "mug=the mug in `image`"]);
    expect(r.code).toBe(0);
    expect(r.stdout).toMatch(/mug: box 0\.440,0\.250,0\.840,0\.820 \(l,t,r,b\)\s+conf 0\.92/);
    // biome-ignore lint/suspicious/noExplicitAny: inspecting the wire format
    expect(Object.keys((h.api().requests[0]!.body as any).state)).toEqual(["image"]);
  });

  test("text-only requests do not send the images header", async () => {
    const r = await h.run(["ask", "hello", "--noul", "q=Is this a greeting?"]);
    expect(r.code).toBe(0);
    expect(h.api().requests[0]!.headers["typesafe-danger-zone-images"]).toBeUndefined();
  });
});
