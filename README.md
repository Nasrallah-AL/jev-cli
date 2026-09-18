# jev-cli

[![CI](https://github.com/nasrshaer/jev-cli/actions/workflows/ci.yml/badge.svg)](https://github.com/nasrshaer/jev-cli/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/jev-cli.svg)](https://www.npmjs.com/package/jev-cli)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

Fast, typed judgments from TypeSafe's [Jev](https://docs.typesafe.ai) model at the command line.

`jev verify` checks claims against evidence. `jev screen` judges text for prompt injection before an agent reads it. `jev find` ranks candidates by meaning with no embeddings. `jev ask` sends any state and any typed questions. Every call returns calibrated probabilities and confidence in a few hundred milliseconds for a fraction of a cent, prints as a table or JSON, and sets an exit code your scripts can branch on.

This is the command-line sibling of [jev-mcp](https://github.com/jkudish/jev-mcp), which exposes the same judgments as MCP tools. The question design is shared and follows the TypeSafe cookbooks.

## Install

Requires Node.js 20.12 or newer and a TypeSafe API key from [console.typesafe.ai/settings/keys](https://console.typesafe.ai/settings/keys).

```bash
npm install -g jev-cli
export TYPESAFE_API_KEY=ts_...
jev config            # confirms the key is detected and shows the resolved provider
```

Or run without installing:

```bash
npx jev-cli verify "Helmets are optional for adults" --evidence @ordinance.txt
```

## Quick tour

```bash
# Verify claims in a PR description against the diff. Exit 2 if anything is contradicted.
git diff main | jev verify --claims @pr-claims.txt --evidence -

# Screen a fetched page before feeding it to an agent. Exit 2 on block.
curl -s https://example.com/pricing | jev screen --purpose "extract pricing tiers" && echo safe

# Find the file that answers a question. No index, no embeddings.
jev find "how does caching affect infra cost" --files docs/*.md -k 3

# Ask raw questions and get typed answers.
jev ask "I was charged twice. Fix this now." \
  --noul urgent="Does this convey urgency?" \
  --choice team="Which team should handle this?|billing:refunds and invoices,technical:bugs and outages,sales" \
  --score frustration="How frustrated is the customer?|calm,frustrated,very angry"
```

Add `--json` to any command for machine-readable output.

## Commands

### `jev verify [claims...]`

Check each claim against the evidence. One call returns a verdict per claim (`verified`, `contradicted`, `unsupported`), the full probability distribution, confidence, and whether the verdict stands on its own (`auto`) or needs a human (`review`). With more than one evidence item, each claim is also matched to the item it rests on.

| Option | Meaning |
| --- | --- |
| `-e, --evidence <ref>` | Evidence text, `@file`, or `-` for stdin. Repeatable. Files are identified by basename. |
| `--evidence-json <ref>` | JSON evidence: array of strings, array of `{id, text}`, or an `{id: text}` map. |
| `-c, --claims <ref>` | Claims from `@file` or `-`: one per line, or a JSON array of strings. |
| `--auto-accept <p>` | Confidence at or above which a verdict stands. Default `0.8`. |
| `--fail-on <list>` | Exit 2 when any result matches: `contradicted`, `unsupported`, `review`, `unknown`, or `none`. Default `contradicted`. |

```jsonc
// jev verify "Helmets are optional for adults" "Reflective gear is mentioned" -e @ordinance.txt --json
{
  "command": "verify",
  "summary": { "verified": 1, "contradicted": 1, "unsupported": 0, "needs_review": 0 },
  "results": [
    { "claim": "Helmets are optional for adults", "verdict": "contradicted", "confidence": 1, "action": "auto",
      "probabilities": { "supports": 0, "contradicts": 1, "says_nothing": 0 }, "supporting_evidence": null },
    { "claim": "Reflective gear is mentioned", "verdict": "verified", "confidence": 1, "action": "auto", ... }
  ],
  "usage": { "input_tokens": 312, "output_tokens": 48 }
}
```

Pattern: [citation check cookbook](https://docs.typesafe.ai/cookbooks/citation_check). For quote-level checks, match quotes against the source in code first and send only the surviving claims.

### `jev screen [text]`

Judge text before an agent reads it. Returns the probability the text contains instructions aimed at an AI agent (prompt injection), whether it has substance, and, when a purpose is given, whether it is relevant. The recommendation is advisory: `pass`, `review`, `block`, or `skip`. Enforcement stays with you, typically via the exit code.

| Option | Meaning |
| --- | --- |
| `[text]` | Text, `@file`, or `-`. Defaults to stdin when piped. |
| `-p, --purpose <text>` | What the consumer is trying to do. Enables the relevance check and the `skip` action. |
| `--block-at <p>` | Injection probability at or above which to block. Default `0.75`. |
| `--review-at <p>` | Injection probability at or above which to flag for review. Default `0.25`. |
| `--fail-on <list>` | Exit 2 when the recommendation is one of `block`, `review`, `skip`, or `none`. Default `block`. |

```text
$ curl -s https://shop.example/sale | jev screen --purpose "summarize the products"
BLOCK  injection probability 0.99 >= block threshold 0.75
injection 0.99 · substance 0.97 · relevance 0.97
```

Pattern: [guardrails cookbook](https://docs.typesafe.ai/cookbooks/llm_guardrails).

### `jev find <query>`

Rank up to 250 candidates against a plain-language query. One Choice scores every candidate; a Noul reports whether any candidate answers the query at all, so a confident top hit cannot masquerade as an answer when none exists. Candidate text is truncated at 2,000 characters.

| Option | Meaning |
| --- | --- |
| `-c, --candidates <ref>` | JSON candidates (`@file` or `-`): array of strings, array of `{id, text}`, or an `{id: text}` map. |
| `-f, --files <paths...>` | Each file is a candidate. Its id is the path. |
| `-l, --lines <ref>` | Each non-empty line of `@file` or `-` is a candidate with id `L<n>`. |
| `-k, --top-k <n>` | How many ranked results to show. Default `5`. |
| `--found <p>` / `--absent <p>` | Exists probability thresholds for `answered` and `absent`. Defaults `0.7` and `0.35`. |
| `--fail-on <list>` | Exit 2 when the exists verdict is `absent` or `partial`. Default `none`. |

```text
$ jev find "how do I rotate API keys" --files docs/*.md -k 2
answered  (exists 0.99)  how do I rotate API keys

#  Prob  Id                Text
-  ----  ----------------  ------------------------------------------------------------
1  0.99  docs/auth.md      To rotate an API key: create a new key in Settings > Keys, …
2  0.01  docs/billing.md   Invoices are issued monthly and can be downloaded as PDF.
```

Pattern: [semantic find cookbook](https://docs.typesafe.ai/cookbooks/semantic_find).

### `jev ask [state]`

The raw System One request: any state, any questions. Use `--questions` with a JSON map in the [API shape](https://docs.typesafe.ai/api), or compose questions from flags.

| Option | Meaning |
| --- | --- |
| `[state]` | Text, `@file`, or `-`. Defaults to stdin when piped. |
| `--state-json` | Parse the state as JSON so you can send objects or arrays. |
| `-q, --questions <ref>` | JSON questions map (`@file` or `-`). |
| `--noul <id=instructions>` | Yes/no question. Repeatable. |
| `--choice <id=instructions\|a,b:desc,c>` | Pick-one question. Options after `\|`, comma separated, optional `label:description`. Repeatable. |
| `--score <id=instructions\|low,mid,high>` | Ordered rubric question. Levels after `\|`. Repeatable. |

Escape a literal `|` or `,` inside shorthand text with a backslash. Question ids must be letters, digits, `_`, `-`, or `.`.

```text
$ jev ask @ticket.txt --noul urgent="Does this convey urgency?" --choice team="Which team?|billing,technical,sales"
urgent: 0.92
team: billing  conf 0.82  [billing 0.85, technical 0.08, sales 0.07]
```

### `jev models`

List the models your TypeSafe account can use. Direct TypeSafe provider only.

### `jev config`

`jev config` (or `jev config show`) prints the effective configuration, which credentials are present (masked), and which provider would be used. It exits 1 if no provider can be resolved, which makes it a quick health check.

```bash
jev config path                      # where the file lives
jev config init                      # write defaults
jev config set model jev-1.13.0      # pin a version
jev config set screen.blockAt 0.6    # tune a threshold
jev config unset screen              # drop a section
jev config reset                     # delete the file
```

## Global options

| Option | Meaning |
| --- | --- |
| `--json` / `--format <text\|json>` | Output format. Text is the default. |
| `-m, --model <name>` | Model, e.g. `jev-latest` or a pinned `jev-1.13.0`. |
| `-P, --provider <name>` | `auto`, `typesafe`, `openrouter`, or `cloudflare`. |
| `--timeout <ms>` | Per-request timeout. Default `30000`. |
| `--dry-run` | Print the exact `state` and `questions` that would be sent and exit. No API call. |
| `-q, --quiet` | Omit the token usage footer in text output. |
| `--no-color` | Disable colors. `NO_COLOR` and `FORCE_COLOR` are honored too. |

Global options work before or after the subcommand.

### Input references

Anywhere a value is accepted, `@path` reads a file, `-` reads stdin, and `@@text` is a literal that starts with `@`. Stdin is read once and shared, so `--claims -` and `--evidence -` cannot both be stdin in one call.

## Exit codes

| Code | Meaning |
| --- | --- |
| `0` | Success, and no `--fail-on` condition matched. |
| `1` | Usage, configuration, input, or transport error. |
| `2` | The command completed and a `--fail-on` judgment condition matched. |

Exit code 2 is what makes `jev` useful in `&&` chains, pre-commit hooks, and CI steps.

## Configuration

Resolution order, later wins: built-in defaults, config file, environment variables, command-line flags.

Config file: `$JEV_CONFIG`, else `$XDG_CONFIG_HOME/jev/config.json`, else `~/.config/jev/config.json`.

```json
{
  "provider": "auto",
  "model": "jev-latest",
  "timeoutMs": 30000,
  "format": "text",
  "verify": { "autoAccept": 0.8 },
  "screen": { "blockAt": 0.75, "reviewAt": 0.25 },
  "find": { "topK": 5, "found": 0.7, "absent": 0.35 }
}
```

| Environment variable | Purpose |
| --- | --- |
| `TYPESAFE_API_KEY` | Direct TypeSafe access. Default provider when set. Recommended. |
| `TYPESAFE_BASE_URL` | Custom TypeSafe endpoint origin, for proxies or tests. |
| `OPENROUTER_API_KEY` | OpenRouter `sk-or-` key. Used when no TypeSafe key is present. |
| `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID` | Cloudflare Workers AI. Used when no other key is present. `JEV_CLOUDFLARE_API_TOKEN` is honored first. |
| `JEV_PROVIDER` | Force `typesafe`, `openrouter`, or `cloudflare` instead of auto-detection. |
| `JEV_MODEL` | Default model. |
| `JEV_TIMEOUT_MS` | Default per-request timeout. |
| `JEV_FORMAT` | Default output format. |
| `JEV_CONFIG` | Config file path. |
| `JEV_DEBUG=1` | Print stack traces on errors. |

### Providers

Direct TypeSafe is the recommended default: lowest latency, `jev-latest` alias, pinned versions, retries with backoff built into the SDK. OpenRouter's Decisions API is alpha and serves pinned versions only, so `jev-latest` maps to `typesafe/jev-1.13` there. Cloudflare Workers AI serves the single `typesafe/jev` alias with no version pinning. Vercel AI Gateway is not supported in this CLI.

## Using it from code

The package also exports the command logic so you can embed the same judgments in a Node script.

```ts
import { createAsk, runVerify } from "jev-cli";

const ask = createAsk({ provider: "auto", model: "jev-latest", timeoutMs: 30_000 });
const result = await runVerify(ask, {
  claims: ["The ordinance mentions reflective gear."],
  evidence: [{ id: "ordinance", text: ordinanceText }],
  autoAccept: 0.8,
});
console.log(result.results[0].verdict, result.results[0].confidence);
```

## How the answers work

Jev is TypeSafe's System One model. It returns typed answers with calibrated probability distributions rather than generated text. A verify call is a Choice over `supports` / `contradicts` / `says_nothing`. A screen call is a set of yes/no probabilities. A find call is a Choice over your candidate ids plus an existence check. Code maps those to verdicts and actions; policy stays with you.

Thresholds shipped here (`auto_accept`, `block_at`, `review_at`, exists cutoffs) come from the TypeSafe cookbooks. Treat them as starting points and tune them on your own data before enforcing them. Jev is calibrated, not infallible: typed output guarantees the interface, not the truth. See [how TypeSafe reports confidence](https://docs.typesafe.ai/confidence).

## Development

```bash
npm install
npm run check        # typecheck + lint + unit and CLI tests (no API key needed)
npm run build
npm run test:e2e     # live API tests; requires TYPESAFE_API_KEY
npm run dev -- screen "hello"   # run from source with tsx
```

CLI tests spawn the built binary against a local fake TypeSafe API, so the real SDK and transport are exercised without network access or credentials. See [CONTRIBUTING.md](CONTRIBUTING.md). To report a vulnerability, see [SECURITY.md](SECURITY.md).

## Acknowledgements

Question design and provider handling are adapted from [jev-mcp](https://github.com/jkudish/jev-mcp) by Joey Kudish (MIT).

## License

[MIT](LICENSE)
