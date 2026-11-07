// A minimal stand-in for api.typesafe.ai used by CLI tests. It answers
// /v1/systemone from a handler you supply and /v1/models with a fixed list,
// so the real SDK, transport, and CLI wiring are exercised without a key.

import { createServer, type IncomingHttpHeaders, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { zstdDecompressSync } from "node:zlib";

export type Handler = (body: {
  state: unknown;
  // biome-ignore lint/suspicious/noExplicitAny: tests poke at question shapes freely
  questions: Record<string, any>;
  model: string;
}) => Record<string, unknown>;

export interface FakeApi {
  url: string;
  requests: Array<{
    path: string;
    body: unknown;
    headers: Record<string, string | string[] | undefined>;
    /** Multipart file parts (images), when the request was multipart. */
    parts?: Array<{ name: string; contentType: string | undefined; size: number }>;
  }>;
  close(): Promise<void>;
}

export async function startFakeApi(handler: Handler): Promise<FakeApi> {
  const requests: FakeApi["requests"] = [];
  const server: Server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => {
      chunks.push(chunk);
    });
    req.on("end", () => {
      const { body, parts } = decodeBody(Buffer.concat(chunks), req.headers);
      requests.push({ path: req.url ?? "", body, headers: req.headers, ...(parts ? { parts } : {}) });
      res.setHeader("content-type", "application/json");
      if (req.headers.authorization !== "Bearer test-key") {
        res.statusCode = 401;
        res.end(JSON.stringify({ error: { message: "invalid api key" } }));
        return;
      }
      if (req.method === "GET" && req.url === "/v1/models") {
        res.end(
          JSON.stringify({
            models: [
              { name: "jev-latest", description: "Latest stable", release_date: "2026-08-01" },
              { name: "jev-preview", description: "Latest release", release_date: "2026-08-01" },
            ],
          }),
        );
        return;
      }
      if (req.method === "POST" && req.url === "/v1/systemone") {
        const answers = handler(body as Parameters<Handler>[0]);
        res.end(
          JSON.stringify({ model: "jev-1.13.0", answers, usage: { input_tokens: 42, output_tokens: 7 } }),
        );
        return;
      }
      res.statusCode = 404;
      res.end(JSON.stringify({ error: { message: "not found" } }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    requests,
    close: () => new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve()))),
  };
}

/** Undo the SDK's zstd compression and split multipart (JSON `request` part + image parts). */
function decodeBody(
  raw: Buffer,
  headers: IncomingHttpHeaders,
): { body: unknown; parts?: Array<{ name: string; contentType: string | undefined; size: number }> } {
  if (raw.length === 0) return { body: undefined };
  const data = headers["content-encoding"] === "zstd" ? zstdDecompressSync(raw) : raw;
  const type = headers["content-type"] ?? "";
  const boundary = /multipart\/form-data;\s*boundary=("?)([^";]+)\1/.exec(type)?.[2];
  if (!boundary) return { body: JSON.parse(data.toString("utf8")) };
  let body: unknown;
  const parts: Array<{ name: string; contentType: string | undefined; size: number }> = [];
  const text = data.toString("latin1");
  for (const section of text.split(`--${boundary}`).slice(1)) {
    if (section.startsWith("--")) break;
    const split = section.indexOf("\r\n\r\n");
    const head = section.slice(0, split);
    const content = section.slice(split + 4, section.length - 2);
    const name = /name="([^"]+)"/.exec(head)?.[1] ?? "";
    const contentType = /content-type:\s*([^\r\n]+)/i.exec(head)?.[1];
    if (name === "request") body = JSON.parse(Buffer.from(content, "latin1").toString("utf8"));
    else parts.push({ name, contentType, size: Buffer.byteLength(content, "latin1") });
  }
  return { body, parts };
}

/** Answer every question plausibly based on its type so any command gets a well-formed response. */
export function autoAnswer(overrides: Record<string, unknown> = {}): Handler {
  return ({ questions }) => {
    const answers: Record<string, unknown> = {};
    for (const [id, q] of Object.entries(questions)) {
      if (id in overrides) {
        answers[id] = overrides[id];
        continue;
      }
      if (q.type === "noul") answers[id] = { type: "noul", noul: 0.05 };
      else if (q.type === "choice") {
        const keys = Object.keys(q.criteria);
        const probabilities = Object.fromEntries(
          keys.map((k, i) => [k, i === 0 ? 0.9 : 0.1 / Math.max(1, keys.length - 1)]),
        );
        answers[id] = { type: "choice", choice: keys[0], probabilities, confidence: 0.88 };
      } else if (q.type === "score") {
        const n = q.criteria.length;
        const probabilities = Object.fromEntries(
          Array.from({ length: n }, (_, i) => [String(i), i === n - 1 ? 0.7 : 0.3 / (n - 1)]),
        );
        answers[id] = { type: "score", score: n - 1.3, probabilities, legend: {}, confidence: 0.7 };
      } else if (q.type === "box") {
        answers[id] = {
          type: "box",
          box: { top: 0.25, bottom: 0.82, left: 0.44, right: 0.84 },
          confidence: 0.92,
        };
      }
    }
    return answers;
  };
}
