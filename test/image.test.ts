import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Image, image, noul } from "@typesafe-ai/sdk";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { composeState } from "../src/core/ask.js";
import { containsAsset, loadImage, parseNamedImage, probeImage } from "../src/image.js";
import { IMAGES_HEADER, LONG_CONTEXT_HEADER, requestHeaders, validateAnswers } from "../src/provider.js";
import { jpegHeader, png } from "./helpers/png.js";

describe("image: probing and limits", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "jev-img-"));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  test("reads PNG and JPEG sizes from their headers", () => {
    expect(probeImage(png(400, 300))).toEqual({ format: "png", width: 400, height: 300, animated: false });
    expect(probeImage(png(400, 300, true))?.animated).toBe(true);
    expect(probeImage(jpegHeader(1024, 768))).toEqual({
      format: "jpg",
      width: 1024,
      height: 768,
      animated: false,
    });
    expect(probeImage(Buffer.from("GIF89a........................"))).toBeNull();
  });

  test("loads a valid file as an SDK image with its size, accepting @path", () => {
    const path = join(dir, "ok.png");
    writeFileSync(path, png(400, 300));
    const img = loadImage(`@${path}`);
    expect(img).toMatchObject({ path, format: "png", width: 400, height: 300 });
    expect(img.asset).toBeInstanceOf(Image);
  });

  test("rejects files the API would reject, before any request, with a resize hint", () => {
    const small = join(dir, "small.png");
    writeFileSync(small, png(200, 300));
    expect(() => loadImage(small)).toThrow(/200×300 px; each side must be 280 to 1568 px.*sips -Z 1568/);
    const anim = join(dir, "anim.png");
    writeFileSync(anim, png(400, 300, true));
    expect(() => loadImage(anim)).toThrow(/animated PNG/);
    const gif = join(dir, "x.gif");
    writeFileSync(gif, "GIF89a.......");
    expect(() => loadImage(gif)).toThrow(/not a PNG or JPEG/);
    expect(() => loadImage(join(dir, "missing.png"))).toThrow(/Cannot read image/);
    expect(() => loadImage("-")).toThrow(/stdin is not supported/);
  });

  test("names images from name=path, keeping paths that merely contain =", () => {
    expect(parseNamedImage("door=door.jpg", "image")).toEqual({ name: "door", path: "door.jpg" });
    expect(parseNamedImage("shots/a=b.png", "image2")).toEqual({ name: "image2", path: "shots/a=b.png" });
    expect(parseNamedImage("photo.jpg", "image")).toEqual({ name: "image", path: "photo.jpg" });
  });

  test("composes text or JSON state with named images", () => {
    const a = image(png(300, 300));
    expect(composeState(undefined, [{ name: "image", asset: a }])).toEqual({ image: a });
    expect(composeState("  ", [{ name: "image", asset: a }])).toEqual({ image: a });
    expect(composeState("hello", [{ name: "door", asset: a }])).toEqual({ text: "hello", door: a });
    expect(composeState({ id: 1 }, [{ name: "door", asset: a }])).toEqual({ id: 1, door: a });
    expect(composeState("x", [])).toBe("x");
    expect(() => composeState({ door: 1 }, [{ name: "door", asset: a }])).toThrow(/collides/);
    expect(() => composeState([1], [{ name: "door", asset: a }])).toThrow(/must be an object/);
    expect(() => composeState("x", [{ name: "text", asset: a }])).toThrow(/reserved/);
  });
});

describe("provider: experimental feature headers", () => {
  const q = { q: noul("x") };

  test("images and box questions turn on the images header", () => {
    const a = image(png(300, 300));
    expect(containsAsset({ nested: [{ a }] })).toBe(true);
    expect(containsAsset({ text: "no images" })).toBe(false);
    expect(requestHeaders("typesafe", "text", q)).toEqual({});
    expect(requestHeaders("typesafe", { image: a }, q)).toEqual({ [IMAGES_HEADER]: "true" });
    expect(requestHeaders("typesafe", "t", { b: { type: "box", instructions: "x" } })).toEqual({
      [IMAGES_HEADER]: "true",
    });
    expect(requestHeaders("typesafe", "t", q, true)).toEqual({ [LONG_CONTEXT_HEADER]: "true" });
  });

  test("proxies refuse images, box, and long context instead of failing upstream", () => {
    const a = image(png(300, 300));
    expect(() => requestHeaders("openrouter", { a }, q)).toThrow(/need the typesafe provider/);
    expect(() => requestHeaders("cloudflare", "t", q, true)).toThrow(/--long-context needs the typesafe/);
  });

  test("box answers must carry four numeric edges", () => {
    const questions = { b: { type: "box" } };
    const good = {
      b: { type: "box", box: { top: 0.1, bottom: 0.5, left: 0.2, right: 0.6 }, confidence: 0.9 },
    };
    expect(validateAnswers(questions, good, "m")).toEqual(good);
    expect(() => validateAnswers(questions, { b: { type: "box", box: { top: 0.1 } } }, "m")).toThrow(
      /answer "b" has no valid box edges/,
    );
  });
});
