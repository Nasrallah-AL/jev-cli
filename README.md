# jev-cli

[![CI](https://github.com/Nasrallah-AL/jev-cli/actions/workflows/ci.yml/badge.svg)](https://github.com/Nasrallah-AL/jev-cli/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/jevctl.svg)](https://www.npmjs.com/package/jevctl)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

Fast, typed AI judgments from the command line, powered by TypeSafe's [Jev](https://docs.typesafe.ai) model.

Installed from npm as **`jevctl`**; the command it gives you is **`jev`**.

Jev does not generate text. You give it some content and a question with a fixed set of answers, and it returns a probability for each answer in a few hundred milliseconds for a fraction of a cent. `jev-cli` wraps that into four commands you can pipe into, script around, and gate CI on.

| Command | Question it answers | Typical use |
| --- | --- | --- |
| `jev verify` | Does this evidence support, contradict, or ignore each claim? | Fact-check a PR description, report, or AI summary against its sources |
| `jev screen` | Is this text trying to hijack an AI agent? Is it worth reading? | Guardrail before fetched web pages or emails enter an agent's context |
| `jev find` | Which of these candidates best answers the query? Does any? | Pick the right file, note, or line without building a search index |
| `jev ask` | Anything with a yes/no, pick-one, or rated answer | Classify, route, score, or extract with your own questions |

Every command prints a readable table by default, full JSON with `--json`, and an exit code you can branch on.

## Contents

- [Install](#install)
- [Sixty-second start](#sixty-second-start)
- [Commands](#commands)
- [Passing input](#passing-input)
- [Output and exit codes](#output-and-exit-codes)
- [Configuration](#configuration)
- [Guidelines for good results](#guidelines-for-good-results)
- [Recipes](#recipes)
- [Troubleshooting](#troubleshooting)
- [Use from Node.js](#use-from-nodejs)
- [Development](#development)

## Install

You need Node.js 20.12 or newer and a TypeSafe API key.

1. Create a key at [console.typesafe.ai/settings/keys](https://console.typesafe.ai/settings/keys).
2. Install the CLI:

   ```bash
   npm install -g jevctl
   ```

3. Export the key and confirm it is picked up:

   ```bash
   export TYPESAFE_API_KEY=your_key_here
   jev config
   ```

   `jev config` prints the resolved settings and a masked view of the key. It exits 1 if no credentials are found.

To try it without installing, prefix any command with `npx jevctl` instead of `jev`. The installed command is always `jev`.

## Sixty-second start

```bash
# 1. Verify two claims against one piece of evidence.
jev verify "Helmets are optional for adults" "Reflective gear is mentioned" \
  --evidence "Every rider must wear an approved helmet. Riders under 18 must wear reflective gear after dark."
```

```text
#  Verdict       Conf  Action  Claim
-  ------------  ----  ------  -------------------------------
1  contradicted  1.00  auto    Helmets are optional for adults
2  verified      1.00  auto    Reflective gear is mentioned

1 verified · 1 contradicted · 0 unsupported · 0 need review (auto-accept ≥ 0.8)
604 in / 91 out tokens · jev-1.13.0 via typesafe
```

The command exited with code 2 because a claim was contradicted. That is the default `--fail-on` policy for `verify`.

```bash
# 2. Screen a web page before an agent reads it. Exit 2 means "block".
curl -s https://example.com/pricing | jev screen --purpose "extract pricing tiers"

# 3. Find which doc answers a question. No index, no embeddings.
jev find "how do I rotate API keys" --files docs/*.md

# 4. Ask your own questions. Answers come back typed.
jev ask "I was charged twice. Fix this now." \
  --noul urgent="Does this convey urgency?" \
  --choice team="Which team should handle this?|billing,technical,sales"

# 5. See exactly what would be sent, without calling the API.
jev screen "some text" --dry-run
```

## Commands

### `jev verify`

Checks each claim against the evidence you provide. For every claim you get a verdict, the probability of each possible verdict, a confidence score, and whether the verdict can be trusted automatically or should be reviewed by a person.

```bash
jev verify [claims...] --evidence <ref> [--evidence <ref>...] [options]
```

| Verdict | Meaning |
| --- | --- |
| `verified` | The evidence states the claim or directly implies it |
| `contradicted` | The evidence says the opposite |
| `unsupported` | The evidence does not address the claim either way |

| Option | Meaning | Default |
| --- | --- | --- |
| `-e, --evidence <ref>` | Evidence text, `@file`, or `-` for stdin. Repeat for several sources. Files are labeled by filename. | required |
| `--evidence-json <ref>` | Evidence as JSON: `["text", ...]`, `[{"id": "...", "text": "..."}]`, or `{"id": "text"}` | |
| `-c, --claims <ref>` | Claims from a file or stdin: one per line, or a JSON array of strings | |
| `--auto-accept <p>` | Confidence at or above which a verdict is marked `auto` instead of `review` | `0.8` |
| `--fail-on <list>` | Exit 2 if any result is one of: `contradicted`, `unsupported`, `review`, `unknown`. Use `none` to always exit 0. | `contradicted` |

When you pass more than one evidence source, each result also names the source the claim rests on (`supporting_evidence` in JSON, a `Source` column in text).

```bash
# Claims in a file, two evidence documents, strict policy
jev verify --claims @claims.txt -e @spec.md -e @rfc.txt --fail-on contradicted,unsupported

# Evidence from stdin
git diff main | jev verify "This change only touches tests" --evidence -
```

### `jev screen`

Judges a piece of text before an AI agent consumes it. Returns three probabilities and a recommendation.

```bash
jev screen [text] [--purpose <text>] [options]
```

| Probability | Question asked |
| --- | --- |
| `injection` | Does the text contain instructions aimed at an AI agent, such as "ignore previous instructions" or "visit this URL"? |
| `substance` | Is there real content, as opposed to an error page or boilerplate? |
| `relevance` | Is the text useful for the stated `--purpose`? Only asked when a purpose is given. |

| Recommendation | When |
| --- | --- |
| `block` | `injection` at or above `--block-at` |
| `review` | `injection` at or above `--review-at` |
| `skip` | Low `substance` or low `relevance`. Not dangerous, just not worth reading. |
| `pass` | None of the above |

| Option | Meaning | Default |
| --- | --- | --- |
| `[text]` | Text, `@file`, or `-`. Reads stdin when omitted and piped. | stdin |
| `-p, --purpose <text>` | What the consumer is trying to do. Enables the relevance check and `skip`. | |
| `--block-at <p>` | Injection probability that triggers `block` | `0.75` |
| `--review-at <p>` | Injection probability that triggers `review` | `0.25` |
| `--fail-on <list>` | Exit 2 when the recommendation is one of `block`, `review`, `skip`. Use `none` to always exit 0. | `block` |

The recommendation is advisory. `jev` never blocks anything itself. Enforcement is the exit code, or your code reading the JSON.

```text
$ curl -s https://shop.example/sale | jev screen --purpose "summarize the products"
BLOCK  injection probability 0.99 >= block threshold 0.75
injection 0.99 · substance 0.97 · relevance 0.97
```

### `jev find`

Ranks candidates against a plain-language query. One call scores every candidate and also reports whether any candidate answers the query at all, so a confident top hit cannot masquerade as an answer when none exists.

```bash
jev find <query> (--files <paths...> | --candidates <ref> | --lines <ref>) [options]
```

| Option | Meaning | Default |
| --- | --- | --- |
| `-f, --files <paths...>` | Each file is a candidate. Its id is the path. | |
| `-c, --candidates <ref>` | JSON candidates: `["text", ...]`, `[{"id": "...", "text": "..."}]`, or `{"id": "text"}` | |
| `-l, --lines <ref>` | Each non-empty line of a file or stdin is a candidate with id `L1`, `L2`, ... | |
| `-k, --top-k <n>` | How many ranked results to show | `5` |
| `--found <p>` | Exists probability at or above which the verdict is `answered` | `0.7` |
| `--absent <p>` | Exists probability below which the verdict is `absent`. In between is `partial`. | `0.35` |
| `--fail-on <list>` | Exit 2 when the exists verdict is `absent` or `partial` | `none` |

Limits: 250 candidates per call. Each candidate's text is truncated to 2,000 characters before sending.

```text
$ jev find "how do I rotate API keys" --files docs/*.md -k 2
answered  (exists 0.99)  how do I rotate API keys

#  Prob  Id               Text
-  ----  ---------------  ------------------------------------------------------------
1  0.99  docs/auth.md     To rotate an API key: create a new key in Settings > Keys, …
2  0.01  docs/billing.md  Invoices are issued monthly and can be downloaded as PDF.
```

### `jev ask`

The general form. Send any state and any number of questions; get one typed answer per question. Questions run in parallel over the same state, so asking five costs about the same latency as asking one.

```bash
jev ask [state] (--noul ... | --choice ... | --score ... | --questions <ref>) [options]
```

Three question types:

| Flag | Answer type | Shorthand format |
| --- | --- | --- |
| `--noul` | Probability of "yes", from 0 to 1 | `id=Question text?` |
| `--choice` | One option from a set, with a probability for each and a confidence | `id=Question text?\|optionA,optionB:description,optionC` |
| `--score` | A position on an ordered scale, with a probability per level and a confidence | `id=Question text?\|low level,middle level,high level` |

| Option | Meaning |
| --- | --- |
| `[state]` | Text, `@file`, or `-`. Reads stdin when omitted and piped. |
| `--state-json` | Treat the state as JSON so you can send an object or array |
| `-q, --questions <ref>` | A JSON questions map in the [TypeSafe API shape](https://docs.typesafe.ai/api), instead of shorthand flags |

Shorthand rules: the `=` separates the id from the question, the first `|` separates the question from its options, and options are comma separated. Write `\|` or `\,` for a literal pipe or comma. Ids may contain letters, digits, `_`, `-`, and `.`.

```text
$ jev ask @ticket.txt --noul urgent="Does this convey urgency?" \
    --choice team="Which team?|billing:refunds and invoices,technical:bugs and outages,sales" \
    --score frustration="How frustrated is the customer?|calm,frustrated,very angry"
urgent: 0.92
team: billing  conf 0.82  [billing 0.85, technical 0.08, sales 0.07]
frustration: 1.60  conf 0.71  [0 0.10, 1 0.20, 2 0.70]
```

### `jev models`

Lists the models your account can use, with release dates. Requires the TypeSafe provider.

### `jev config`

Manages the config file and shows the effective settings.

| Subcommand | Does |
| --- | --- |
| `jev config` or `jev config show` | Print effective settings, masked credentials, and the resolved provider. Exit 1 if none. |
| `jev config path` | Print the config file location |
| `jev config init` | Write a file with the defaults |
| `jev config set <key> <value>` | Set one value, e.g. `jev config set screen.blockAt 0.6` |
| `jev config unset <key>` | Remove a top-level key |
| `jev config reset` | Delete the file |

## Passing input

Every place that accepts a value accepts three forms:

| You write | jev reads |
| --- | --- |
| `some text` | The literal text |
| `@path/to/file` | The file's contents |
| `-` | Standard input |
| `@@text` | The literal text `@text` (escape for values that start with `@`) |

Stdin is read once and shared, so only one argument per command can be `-`.

Lists (claims) accept one item per line or a JSON array of strings. Items with ids (evidence, candidates) accept a JSON array of strings, an array of `{id, text}` objects, or an object mapping id to text.

## Output and exit codes

Text output is the default and is meant for humans. Add `--json` for scripts. The JSON always includes `command`, `model`, `provider`, and `usage` (token counts), plus the command's results. Field names are a stable contract and changes are noted in [CHANGELOG.md](CHANGELOG.md).

| Exit code | Meaning |
| --- | --- |
| `0` | Success, and no `--fail-on` condition matched |
| `1` | Usage, configuration, input, or network error. Details on stderr. |
| `2` | The command ran fine, but a `--fail-on` condition matched |

Code 2 is what lets `jev` act as a gate in `&&` chains, hooks, and CI steps.

### Global options

Work before or after the subcommand.

| Option | Meaning |
| --- | --- |
| `--json` | JSON output. Same as `--format json`. |
| `-m, --model <name>` | Model to use, e.g. `jev-latest` or a pinned `jev-1.13.0` |
| `-P, --provider <name>` | `auto`, `typesafe`, `openrouter`, or `cloudflare` |
| `--timeout <ms>` | Per-request timeout. Default `30000`. |
| `--dry-run` | Print the exact request that would be sent, then exit 0 without calling the API |
| `-q, --quiet` | Omit the token usage footer in text output |
| `--no-color` | Disable colors. `NO_COLOR` and `FORCE_COLOR` environment variables are also honored. |

## Configuration

Settings resolve in this order, later wins: built-in defaults, config file, environment variables, command-line flags.

The config file lives at `$JEV_CONFIG` if set, else `$XDG_CONFIG_HOME/jev/config.json`, else `~/.config/jev/config.json`. It never holds API keys.

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

### Environment variables

| Variable | Purpose |
| --- | --- |
| `TYPESAFE_API_KEY` | TypeSafe API key. Recommended provider; used automatically when set. |
| `TYPESAFE_BASE_URL` | Alternate TypeSafe endpoint, for proxies or testing |
| `OPENROUTER_API_KEY` | OpenRouter key (`sk-or-...`). Used when no TypeSafe key is present. |
| `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` | Cloudflare Workers AI. Used when no other key is present. `JEV_CLOUDFLARE_API_TOKEN` takes precedence over `CLOUDFLARE_API_TOKEN` if you need separate credentials. |
| `JEV_PROVIDER` | Force `typesafe`, `openrouter`, or `cloudflare` |
| `JEV_MODEL` | Default model |
| `JEV_TIMEOUT_MS` | Default timeout |
| `JEV_FORMAT` | Default output format, `text` or `json` |
| `JEV_CONFIG` | Config file path |
| `JEV_DEBUG=1` | Print stack traces on errors |

### Providers

| Provider | Notes |
| --- | --- |
| TypeSafe (direct) | Recommended. Lowest latency, `jev-latest` alias, pinned versions, automatic retries with backoff. |
| OpenRouter | Alpha endpoint. Serves pinned versions only, so `jev-latest` maps to `typesafe/jev-1.13`. Adds a network hop. |
| Cloudflare Workers AI | Serves the single `typesafe/jev` alias, no version pinning. Adds a network hop. |

## Guidelines for good results

**Write claims as single, checkable statements.** "The API returns JSON and supports pagination" is two claims. Split them so each gets its own verdict.

**Give the model everything it needs, and only that.** Evidence should contain the passages the claims depend on. Very long evidence dilutes accuracy and costs more. For quote-level checks, locate the relevant passage in code first and send only that.

**Treat thresholds as starting points.** The defaults (`0.8` auto-accept, `0.75` block, `0.25` review, `0.7`/`0.35` exists) come from TypeSafe's published cookbooks. Run `jev` over a sample of your own data with `--json`, look at the distributions, and set thresholds that match the cost of a wrong answer in your situation. Pin a model version with `--model jev-1.13.0` once you have tuned them, so an alias update does not silently shift results.

**Read confidence correctly.** For `choice` and `score` answers, confidence measures how concentrated the probability distribution is. Low confidence means the options were close, not that the model is wrong. For `noul` answers there is no separate confidence; a value near `0.5` means "as likely yes as no".

**Keep policy in your code.** `jev` reports judgments. Whether to block, retry, escalate, or ignore is your decision, expressed through `--fail-on` or by reading the JSON.

**Mind what you send.** Everything you pass is sent to the configured provider. Do not include secrets or data you are not permitted to share. `--dry-run` shows the exact payload.

**Watch cost with the usage footer.** Each result reports input and output tokens. Only input tokens are billed. Batching several questions into one `jev ask` call is cheaper and faster than several calls.

**Prefer direct TypeSafe.** Proxies add latency and lag behind on model versions.

## Recipes

**Gate a pull request on its own description.** Put each claim from the PR body on its own line in `claims.txt`, then:

```bash
git diff origin/main...HEAD | jev verify --claims @claims.txt --evidence - --fail-on contradicted,unsupported
```

**Guard an agent's web fetches.** Only pass content through if it is safe and relevant:

```bash
page=$(curl -s "$url")
if printf '%s' "$page" | jev screen --purpose "$task" --fail-on block,review,skip -q; then
  printf '%s' "$page" | my-agent --context -
fi
```

**Route a support ticket in a shell script.**

```bash
team=$(jev ask @ticket.txt --choice team="Which team?|billing,technical,sales" --json | jq -r .answers.team.choice)
```

**Find the right file, then open it.**

```bash
jev find "where is retry logic configured" --files src/**/*.ts --json | jq -r '.top[0].id' | xargs code
```

**Check that a knowledge base actually answers a question** before handing the top hit to a user:

```bash
jev find "$question" --lines @faq.txt --fail-on absent,partial --json
```

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| `No credentials found` | Export `TYPESAFE_API_KEY`, then run `jev config` to confirm it is visible to the process |
| `HTTP 401` | The key is wrong or revoked. Check it at console.typesafe.ai and re-export. |
| `HTTP 429` | Rate limited. The TypeSafe provider retries automatically; if it persists, slow down or batch questions. |
| `Request timed out` | Raise `--timeout` or set `JEV_TIMEOUT_MS`. Large evidence takes longer. |
| `Expected ... on stdin but stdin is a terminal` | You used `-` without piping anything in. Pass text or `@file` instead. |
| `Too many candidates` | `find` accepts 250 per call. Pre-filter in code or split the set. |
| Colors in captured output | Add `--no-color` or set `NO_COLOR=1` |
| Want to see the request | Add `--dry-run` |
| Want a stack trace | Set `JEV_DEBUG=1` |

## Use from Node.js

The same functions the CLI uses are exported, so you can embed judgments in a script without shelling out.

```ts
import { createAsk, runVerify, runScreen, runFind } from "jevctl";

const ask = createAsk({ provider: "auto", model: "jev-latest", timeoutMs: 30_000 });

const verdicts = await runVerify(ask, {
  claims: ["The ordinance mentions reflective gear."],
  evidence: [{ id: "ordinance", text: ordinanceText }],
  autoAccept: 0.8,
});
console.log(verdicts.results[0].verdict, verdicts.results[0].confidence);

const screened = await runScreen(ask, { text: pageHtml, purpose: "extract prices", blockAt: 0.75, reviewAt: 0.25 });
if (screened.recommendation.action === "block") throw new Error(screened.recommendation.reason);
```

## Development

```bash
git clone https://github.com/Nasrallah-AL/jev-cli
cd jev-cli
npm install
npm run check        # typecheck, lint, and tests. No API key needed.
npm run build        # compiles to dist/
npm run dev -- screen "hello" --dry-run   # run from source
npm run test:e2e     # live API tests. Requires TYPESAFE_API_KEY.
```

Tests never touch the network: CLI tests spawn the built binary against a local fake TypeSafe API. See [CONTRIBUTING.md](CONTRIBUTING.md) for layout and pull request expectations, and [SECURITY.md](SECURITY.md) to report a vulnerability.

## License

[MIT](LICENSE)
