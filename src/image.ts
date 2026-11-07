// Image inputs (Jev 1.13+, "dreamer-ready"). Files are checked locally against
// the API's documented limits so a bad file fails before a paid request, with
// a hint on how to fix it. Nothing is resized: the API rejects, never resizes,
// and silently changing pixels would change what the model judges.

import { readFileSync, statSync } from "node:fs";
import { Image, image } from "@typesafe-ai/sdk";
import { CliError } from "./errors.js";

/** Limits from https://docs.typesafe.ai/images#limits (both ends inclusive). */
export const IMAGE_LIMITS = {
  maxFileBytes: 16 * 1024 * 1024,
  minSide: 280,
  maxSide: 1568,
  minPixels: 280 * 280,
  maxPixels: 1568 * 1568,
} as const;

export type ImageFormat = "png" | "jpg";

export interface LoadedImage {
  /** The path the user gave. */
  path: string;
  format: ImageFormat;
  width: number;
  height: number;
  bytes: number;
  /** SDK asset; `String(asset)` is the reference the request carries. */
  asset: Image;
}

/** Description of a loaded image for JSON output and dry runs (no bytes). */
export function describeImage(img: LoadedImage) {
  return { path: img.path, format: img.format, width: img.width, height: img.height, bytes: img.bytes };
}

/** The `assets` map a dry run prints: reference -> file description. */
export function dryRunAssets(images: LoadedImage[]): Record<string, ReturnType<typeof describeImage>> {
  return Object.fromEntries(images.map((img) => [String(img.asset), describeImage(img)]));
}

const RESIZE_HINT =
  "Resize so the longest side is at most 1568 px and the shortest at least 280 px " +
  "(macOS: `sips -Z 1568 <file>`; ImageMagick: `magick <file> -resize '1568x1568>' out.jpg`).";

/** Read an image file and check it against the API limits. Accepts `@path` or a bare path. */
export function loadImage(raw: string, label = "image"): LoadedImage {
  const path = raw.startsWith("@") && !raw.startsWith("@@") ? raw.slice(1) : raw;
  if (!path || path === "-")
    throw new CliError(`${label}: give a PNG or JPEG file path (stdin is not supported).`);
  let size: number;
  let data: Buffer;
  try {
    size = statSync(path).size;
    if (size > IMAGE_LIMITS.maxFileBytes) {
      throw new CliError(
        `${label} ${path} is ${mib(size)} MiB; the limit is 16 MiB per image. ${RESIZE_HINT}`,
      );
    }
    data = readFileSync(path);
  } catch (err) {
    if (err instanceof CliError) throw err;
    throw new CliError(`Cannot read ${label} ${path}: ${(err as NodeJS.ErrnoException).message}`);
  }
  const info = probeImage(data);
  if (!info) {
    throw new CliError(
      `${label} ${path} is not a PNG or JPEG. Convert it first (macOS: \`sips -s format jpeg <file> --out out.jpg\`).`,
    );
  }
  if (info.animated) {
    throw new CliError(`${label} ${path} is an animated PNG; export one frame as a still PNG or JPEG.`);
  }
  const { width, height } = info;
  const pixels = width * height;
  if (
    width < IMAGE_LIMITS.minSide ||
    height < IMAGE_LIMITS.minSide ||
    width > IMAGE_LIMITS.maxSide ||
    height > IMAGE_LIMITS.maxSide ||
    pixels < IMAGE_LIMITS.minPixels ||
    pixels > IMAGE_LIMITS.maxPixels
  ) {
    throw new CliError(
      `${label} ${path} is ${width}×${height} px; each side must be 280 to 1568 px. ${RESIZE_HINT}`,
    );
  }
  return { path, format: info.format, width, height, bytes: size, asset: image(data) };
}

export interface ImageProbe {
  format: ImageFormat;
  width: number;
  height: number;
  animated: boolean;
}

/** Read format and dimensions from PNG IHDR or a JPEG SOF marker. Returns null for anything else. */
export function probeImage(buf: Uint8Array): ImageProbe | null {
  const b = Buffer.from(buf.buffer, buf.byteOffset, buf.byteLength);
  // PNG: 8-byte signature, then IHDR (width, height as big-endian u32).
  if (b.length >= 24 && b.readUInt32BE(0) === 0x89504e47 && b.readUInt32BE(4) === 0x0d0a1a0a) {
    if (b.toString("latin1", 12, 16) !== "IHDR") return null;
    return {
      format: "png",
      width: b.readUInt32BE(16),
      height: b.readUInt32BE(20),
      animated: pngIsAnimated(b),
    };
  }
  // JPEG: SOI, then segments until a start-of-frame marker carrying the size.
  if (b.length >= 4 && b[0] === 0xff && b[1] === 0xd8) {
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) {
        i++;
        continue;
      }
      const marker = b[i + 1]!;
      if (marker === 0xff) {
        i++;
        continue;
      }
      // Standalone markers carry no length.
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
        i += 2;
        continue;
      }
      const len = b.readUInt16BE(i + 2);
      const isSof = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
      if (isSof) {
        return {
          format: "jpg",
          height: b.readUInt16BE(i + 5),
          width: b.readUInt16BE(i + 7),
          animated: false,
        };
      }
      if (marker === 0xd9 || marker === 0xda) return null;
      i += 2 + len;
    }
    return null;
  }
  return null;
}

/** An `acTL` chunk before the first `IDAT` marks an animated PNG. */
function pngIsAnimated(b: Buffer): boolean {
  let i = 8;
  while (i + 8 <= b.length) {
    const len = b.readUInt32BE(i);
    const type = b.toString("latin1", i + 4, i + 8);
    if (type === "acTL") return true;
    if (type === "IDAT" || type === "IEND") return false;
    i += 12 + len;
  }
  return false;
}

/** True when a request value carries an SDK asset anywhere inside it. */
export function containsAsset(value: unknown, seen = new Set<unknown>()): boolean {
  if (value instanceof Image) return true;
  if (!value || typeof value !== "object" || seen.has(value)) return false;
  seen.add(value);
  if ("assets" in value && Array.isArray((value as { assets: unknown }).assets)) {
    if ((value as { assets: unknown[] }).assets.length > 0) return true;
  }
  return Object.values(value as Record<string, unknown>).some((v) => containsAsset(v, seen));
}

/** Parse `name=path` (or a bare path, named by `fallback`) for repeatable `--image` flags. */
export function parseNamedImage(raw: string, fallback: string): { name: string; path: string } {
  const eq = raw.indexOf("=");
  if (eq > 0 && /^[A-Za-z_][A-Za-z0-9_]*$/.test(raw.slice(0, eq))) {
    return { name: raw.slice(0, eq), path: raw.slice(eq + 1) };
  }
  return { name: fallback, path: raw };
}

function mib(n: number): string {
  return (n / 1024 / 1024).toFixed(1);
}
