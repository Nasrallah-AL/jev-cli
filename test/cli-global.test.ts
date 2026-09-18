// Behavior shared by every command: version, help, errors, credentials, plus
// the `models` and `config` commands.

import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { cliHarness } from "./helpers/cli.js";

const h = cliHarness();

describe("global behavior", () => {
  test("--version and --help list every command", async () => {
    expect((await h.run(["--version"])).stdout.trim()).toMatch(/^\d+\.\d+\.\d+/);
    const help = await h.run(["--help"]);
    expect(help.code).toBe(0);
    expect(help.stdout).toContain("Exit codes:");
    for (const cmd of [
      "verify",
      "screen",
      "find",
      "ask",
      "classify",
      "extract",
      "batch",
      "models",
      "config",
    ]) {
      expect(help.stdout).toContain(cmd);
    }
  });

  test("unknown command exits 1 with a hint", async () => {
    const r = await h.run(["bogus"]);
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/unknown command/);
  });

  test("missing credentials is a clear error", async () => {
    const r = await h.run(["screen", "hello"], { noApi: true });
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/No credentials found/);
  });

  test("bad API key surfaces the HTTP status", async () => {
    const r = await h.run(["screen", "hello"], { env: { TYPESAFE_API_KEY: "wrong" } });
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/401|invalid api key/i);
  });

  test("global flags work before or after the subcommand", async () => {
    const before = await h.run(["--json", "screen", "hi"]);
    const after = await h.run(["screen", "hi", "--json"]);
    expect(JSON.parse(before.stdout).command).toBe("screen");
    expect(JSON.parse(after.stdout).command).toBe("screen");
  });
});

describe("models", () => {
  test("lists models from the API in text and JSON", async () => {
    const r = await h.run(["models"]);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("jev-latest");
    expect(r.stdout).toContain("jev-preview");
    expect(JSON.parse((await h.run(["models", "--json"])).stdout).models).toHaveLength(2);
  });
});

describe("config", () => {
  test("path, init, set, show, unset, reset round trip", async () => {
    const cfg = join(h.dir(), "cfg", "config.json");
    const env = { JEV_CONFIG: cfg };
    expect((await h.run(["config", "path"], { env })).stdout.trim()).toBe(cfg);

    expect((await h.run(["config", "init"], { env })).code).toBe(0);
    expect((await h.run(["config", "init"], { env })).code).toBe(1);

    expect((await h.run(["config", "set", "screen.blockAt", "0.6"], { env })).code).toBe(0);
    expect((await h.run(["config", "set", "screen.blockAt", "7"], { env })).code).toBe(1);
    expect((await h.run(["config", "set", "batch.concurrency", "8"], { env })).code).toBe(0);

    const out = JSON.parse((await h.run(["config", "show", "--json"], { env })).stdout);
    expect(out.config.screen.blockAt).toBe(0.6);
    expect(out.config.batch.concurrency).toBe(8);
    expect(out.resolved_provider).toBe("typesafe");
    expect(out.credentials.TYPESAFE_API_KEY).toBe("********");
    expect(out.config_file_exists).toBe(true);

    expect((await h.run(["config", "unset", "screen"], { env })).code).toBe(0);
    expect(JSON.parse((await h.run(["config", "--json"], { env })).stdout).config.screen.blockAt).toBe(0.75);
    expect((await h.run(["config", "reset"], { env })).code).toBe(0);
    expect((await h.run(["config", "reset"], { env })).code).toBe(1);
  });

  test("show without credentials reports the problem and exits 1", async () => {
    const r = await h.run(["config"], { noApi: true });
    expect(r.code).toBe(1);
    expect(r.stdout).toMatch(/No credentials found/);
  });
});
