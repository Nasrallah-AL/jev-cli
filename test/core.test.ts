import { describe, expect, test, vi } from "vitest";
import { parseQuestions, questionsFromFlags, runAsk, splitOptions, splitShorthand } from "../src/core/ask.js";
import { buildFindRequest, findFailed, runFind } from "../src/core/find.js";
import { buildScreenRequest, runScreen, screenFailed } from "../src/core/screen.js";
import { buildVerifyRequest, runVerify, verifyFailed } from "../src/core/verify.js";
import type { AskFn, AskResult } from "../src/provider.js";

const usage = { input_tokens: 10, output_tokens: 2 };

/** Fake provider that answers from a lookup and records the request. */
function fakeAsk(answers: Record<string, unknown>): {
  ask: AskFn;
  calls: Array<{ state: unknown; questions: Record<string, unknown> }>;
} {
  const calls: Array<{ state: unknown; questions: Record<string, unknown> }> = [];
  const ask: AskFn = vi.fn(async (state, questions) => {
    calls.push({ state, questions });
    const result: AskResult = { answers, usage, provider: "typesafe", model: "jev-1.13.0" };
    return result;
  });
  return { ask, calls };
}

describe("verify", () => {
  test("builds one relation question per claim and source questions with multiple evidence", () => {
    const single = buildVerifyRequest({ claims: ["a", "b"], evidence: [{ text: "e" }] });
    expect(Object.keys(single.questions)).toEqual(["relation_claim0", "relation_claim1"]);

    const multi = buildVerifyRequest({
      claims: ["a"],
      evidence: [
        { id: "spec.md", text: "e1" },
        { id: "rfc/4.txt", text: "e2" },
      ],
    });
    expect(Object.keys(multi.questions)).toEqual(["relation_claim0", "source_claim0"]);
    const source = multi.questions.source_claim0 as { criteria: Record<string, unknown> };
    expect(Object.keys(source.criteria)).toEqual(["spec.md", "rfc_4.txt", "none"]);
  });

  test("rejects empty inputs", () => {
    expect(() => buildVerifyRequest({ claims: [], evidence: [{ text: "e" }] })).toThrow(/claim/);
    expect(() => buildVerifyRequest({ claims: ["a"], evidence: [] })).toThrow(/evidence/);
  });

  test("maps answers to verdicts, actions, and the original evidence id", async () => {
    const { ask } = fakeAsk({
      relation_claim0: {
        type: "choice",
        choice: "contradicts",
        confidence: 0.97,
        probabilities: { contradicts: 0.97 },
      },
      source_claim0: { type: "choice", choice: "rfc_4.txt", confidence: 0.9, probabilities: {} },
      relation_claim1: {
        type: "choice",
        choice: "supports",
        confidence: 0.5,
        probabilities: { supports: 0.5 },
      },
      source_claim1: { type: "choice", choice: "none", confidence: 0.9, probabilities: {} },
    });
    const out = await runVerify(ask, {
      claims: ["x", "y"],
      evidence: [
        { id: "spec.md", text: "e1" },
        { id: "rfc/4.txt", text: "e2" },
      ],
      autoAccept: 0.8,
    });
    expect(out.results[0]).toMatchObject({
      verdict: "contradicted",
      action: "auto",
      supporting_evidence: "rfc/4.txt",
    });
    expect(out.results[1]).toMatchObject({
      verdict: "verified",
      action: "review",
      supporting_evidence: null,
    });
    expect(out.summary).toEqual({ verified: 1, contradicted: 1, unsupported: 0, needs_review: 1 });
    expect(out.usage).toEqual(usage);

    expect(verifyFailed(out, ["contradicted"])).toBe(true);
    expect(verifyFailed(out, ["unsupported"])).toBe(false);
    expect(verifyFailed(out, ["review"])).toBe(true);
    expect(verifyFailed(out, [])).toBe(false);
  });

  test("missing answers become unknown + review", async () => {
    const { ask } = fakeAsk({});
    const out = await runVerify(ask, { claims: ["x"], evidence: [{ text: "e" }], autoAccept: 0.8 });
    expect(out.results[0]).toMatchObject({ verdict: "unknown", action: "review", confidence: null });
    expect(verifyFailed(out, ["unknown"])).toBe(true);
  });
});

describe("screen", () => {
  test("adds the relevance question only when a purpose is given", () => {
    expect(Object.keys(buildScreenRequest({ text: "t" }).questions)).toEqual(["injection", "substance"]);
    expect(Object.keys(buildScreenRequest({ text: "t", purpose: "p" }).questions)).toEqual([
      "injection",
      "substance",
      "relevance",
    ]);
    expect(() => buildScreenRequest({ text: "   " })).toThrow(/empty/);
  });

  test("turns probabilities into a recommendation", async () => {
    const { ask } = fakeAsk({
      injection: { type: "noul", noul: 0.99 },
      substance: { type: "noul", noul: 0.9 },
      relevance: { type: "noul", noul: 0.8 },
    });
    const out = await runScreen(ask, { text: "x", purpose: "p", blockAt: 0.75, reviewAt: 0.25 });
    expect(out.recommendation.action).toBe("block");
    expect(out.probabilities).toEqual({ injection: 0.99, substance: 0.9, relevance: 0.8 });
    expect(screenFailed(out, ["block"])).toBe(true);
    expect(screenFailed(out, ["review"])).toBe(false);
  });

  test("ignores relevance without a purpose and rejects inverted thresholds", async () => {
    const { ask } = fakeAsk({
      injection: { type: "noul", noul: 0.01 },
      substance: { type: "noul", noul: 0.9 },
      relevance: { type: "noul", noul: 0.0 },
    });
    const out = await runScreen(ask, { text: "x", blockAt: 0.75, reviewAt: 0.25 });
    expect(out.recommendation.action).toBe("pass");
    expect(out.probabilities.relevance).toBeNull();
    await expect(runScreen(ask, { text: "x", blockAt: 0.2, reviewAt: 0.5 })).rejects.toThrow(
      /must not exceed/,
    );
  });
});

describe("find", () => {
  test("builds a Choice over candidate ids plus an exists Noul, truncating long text", () => {
    const { questions, candidates } = buildFindRequest({
      query: "q",
      candidates: [{ id: "a/b.md", text: "x".repeat(5000) }, { text: "short" }],
    });
    expect(Object.keys(questions)).toEqual(["best", "exists"]);
    expect(Object.keys((questions.best as { criteria: object }).criteria)).toEqual(["a_b.md", "candidate1"]);
    expect(candidates[0]!.text).toMatch(/truncated\]$/);
  });

  test("rejects empty and oversized inputs", () => {
    expect(() => buildFindRequest({ query: "", candidates: [{ text: "a" }] })).toThrow(/Query/);
    expect(() => buildFindRequest({ query: "q", candidates: [] })).toThrow(/candidate/);
    const many = Array.from({ length: 251 }, (_, i) => ({ text: `c${i}` }));
    expect(() => buildFindRequest({ query: "q", candidates: many })).toThrow(/Too many/);
  });

  test("ranks, restores original ids, and reports the exists verdict", async () => {
    const { ask } = fakeAsk({
      best: {
        type: "choice",
        choice: "auth",
        probabilities: { billing: 0.01, auth: 0.98, support: 0.01 },
        confidence: 0.97,
      },
      exists: { type: "noul", noul: 0.95 },
    });
    const out = await runFind(ask, {
      query: "rotate keys",
      candidates: [
        { id: "billing", text: "b" },
        { id: "auth", text: "a" },
        { id: "support/faq", text: "s" },
      ],
      topK: 2,
      found: 0.7,
      absent: 0.35,
    });
    expect(out.top.map((h) => h.id)).toEqual(["auth", "billing"]);
    expect(out.exists_verdict).toBe("answered");
    expect(findFailed(out, ["absent"])).toBe(false);

    const { ask: none } = fakeAsk({
      best: { type: "choice", choice: "support_faq", probabilities: { support_faq: 1 }, confidence: 1 },
      exists: { type: "noul", noul: 0.1 },
    });
    const miss = await runFind(none, {
      query: "q",
      candidates: [{ id: "support/faq", text: "s" }],
      topK: 5,
      found: 0.7,
      absent: 0.35,
    });
    expect(miss.top[0]!.id).toBe("support/faq");
    expect(miss.exists_verdict).toBe("absent");
    expect(findFailed(miss, ["absent"])).toBe(true);
  });
});

describe("ask", () => {
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
    const { ask, calls } = fakeAsk({ a: { type: "noul", noul: 0.5 } });
    const questions = parseQuestions({ a: { type: "noul", instructions: "x" } });
    const out = await runAsk(ask, { state: { k: 1 }, questions });
    expect(calls[0]).toEqual({ state: { k: 1 }, questions });
    expect(out.answers).toEqual({ a: { type: "noul", noul: 0.5 } });
    expect(out.model).toBe("jev-1.13.0");
  });
});
