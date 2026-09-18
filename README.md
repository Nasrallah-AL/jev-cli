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
| `jev ask` | Anything with a yes/no, pick-one, or rated answer | Route, score, or triage with your own questions |
| `jev classify` | Which label fits? Which labels apply? Where in this hierarchy? | Label issues, route tickets, tag content |
| `jev extract` | Which of these spans found in the text is the value I want? | Pull emails, amounts, dates, ids out of documents without hallucination |
| `jev rerank` | How relevant is each result to the query, on its own? | Re-order and filter search results before using them |
| `jev match` | Do these two records describe the same thing? | Dedupe contacts, align catalogs, merge duplicates |
| `jev route` | Which handler should take this request, with which arguments? | Turn free text into a typed command for a script or bot |
| `jev batch` | The same question over many rows | Run any of the above over a file at scale, with JSONL output |
| `jev compact` | Which old tool calls and results in this transcript still matter? | Shrink an agent's context without summarizing; also runs in-session as a Claude Code hook |

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
- [Claude Code plugin](#claude-code-plugin)
- [Development](#development)

## Install

You need Node.js 20.12 or newer and a TypeSafe API key.

1. Create a key at [console.typesafe.ai/settings/keys](https://console.typesafe.ai/settings/keys).
2. Install the CLI:

   ```bash
   npm install -g jevctl
   ```

3. Store the key and confirm it is picked up:

   ```bash
   jev auth login      # prompts with hidden input; saves to the OS keychain
   jev config          # shows the resolved settings and where the key came from
   ```

   `jev auth login` writes to the macOS Keychain or the Linux Secret Service, and otherwise to `~/.config/jev/credentials.json` with mode `0600`. Nothing is echoed and nothing lands in your shell history or profile. Setting `TYPESAFE_API_KEY` in the environment also works and takes precedence.

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

### `jev classify`

Assigns labels from a set you define. Three modes.

```bash
jev classify [text] (--labels a,b,c | --labels-json <ref> | --taxonomy <ref>) [--multi] [--other] [options]
```

| Mode | Flag | Returns |
| --- | --- | --- |
| Single (default) | `--labels a,b:description,c` | One `label`, its `confidence`, the full `probabilities`, and `action` (`auto` or `review`) |
| Multi | `--multi` | One probability per label and `applied` (those at or above `--threshold`) |
| Taxonomy | `--taxonomy @tree.json` | A `path` through the hierarchy, decided one level per request, with per-level confidence |

| Option | Meaning | Default |
| --- | --- | --- |
| `-l, --labels <list>` | Comma-separated labels, optionally `label:description`. Escape a literal comma as `\,`. | |
| `--labels-json <ref>` | Labels as `["a","b"]`, `[{"label","description"}]`, or `{"label": "description"}` | |
| `-t, --taxonomy <ref>` | Nested JSON: `{"hardware": {"laptop": null, "phone": null}, "software": ["os", "app"]}` | |
| `--other` | Add an `other` escape option so the model can say nothing fits | off |
| `-i, --instructions <text>` | Replace the default question | |
| `--min-confidence <p>` | Below this confidence the result is `review` | `0.6` |
| `--threshold <p>` | Multi: probability at or above which a label applies | `0.5` |
| `--state-json` | Treat the input as JSON | |
| `--fail-on <list>` | Exit 2 on `review`, `other`, or `unlabeled` (multi: nothing applied) | `none` |

```text
$ jev classify "Login fails after the latest update" -l "bug:defect in an existing feature,feature:new capability,question" --other
bug  conf 0.91  auto
[bug 0.93, question 0.04, feature 0.02, other 0.01]
```

Descriptions matter: put your domain rules in them rather than in the label name. Always add `--other` when the input might not fit any label.

### `jev extract`

Pulls values out of text without letting the model invent them. Regexes find every candidate span in code, Jev picks the one that matches the field's meaning, and code normalizes the verbatim value.

```bash
jev extract [text] --want <field> [--want <field>...] [--context <text>] [options]
```

| Field form | Example | Meaning |
| --- | --- | --- |
| builtin | `--want email,phone,date` | Builtins: `email`, `phone`, `url`, `amount`, `date`, `percent`, `number` |
| custom regex | `--want invoice=/INV-\d+/` | Your pattern, named |
| custom regex with meaning | `--want po=/PO\s?\d{6}/:the purchase order number` | The description drives the question |
| aliased builtin | `--want sender=email:the sender's address` | Same pattern, different meaning, so two emails can be told apart |

| Option | Meaning | Default |
| --- | --- | --- |
| `-c, --context <text>` | What the document is, e.g. `"supplier invoice"` | |
| `--min-confidence <p>` | Below this confidence the value is `review` | `0.6` |
| `--fail-on <list>` | Exit 2 when any field is `review` or `missing` | `none` |

Each field returns `value` (verbatim), `normalized` (lowercased email, digits-only phone, `{value, currency}` for amounts, ISO date, number), `confidence`, `action` (`auto`, `review`, or `none`), and how many `candidates` were found. A field with no regex matches is `none` and costs nothing; if no field has candidates, no API call is made.

```text
$ jev extract @invoice.txt --want amount,date --want invoice=/INV-\d+/ --context "supplier invoice"
Field    Value          Normalized                        Conf  Action  Cands
-------  -------------  --------------------------------  ----  ------  -----
amount   $1,250.00      {"value":1250,"currency":"USD"}   0.97  auto    3
date     Sept 30, 2026  2026-09-30                        0.94  auto    2
invoice  INV-2231                                         1.00  auto    1
```

### `jev rerank`

Scores every candidate's relevance to a query independently, then sorts. Where `find` asks "which one is best" and always crowns a winner, `rerank` asks "is this one relevant" per candidate, so several can pass or none can. Drop it in front of any search: the cookbook shows BM25 top-1 accuracy rising from 5% to 18% with one judgment per pair.

```bash
jev rerank <query> (--candidates <ref> | --files <paths...> | --lines <ref>) [options]
```

| Option | Meaning | Default |
| --- | --- | --- |
| `-c/-f/-l` | Candidates, same forms as `find` | |
| `-k, --top-k <n>` | How many ranked results to return | `10` |
| `--min <p>` | Relevance at or above which a candidate is `kept` | `0.5` |
| `--criteria <text>` | What counts as relevant, e.g. `"a passage stating the rule, not commentary"` | |
| `--fail-on <list>` | Exit 2 on `empty` (nothing kept) | `none` |

Result: `ranked[]` with `id`, `relevance`, `kept`, `text`, plus `kept[]` ids. Up to 250 candidates per call.

### `jev match`

Decides whether pairs of records describe the same thing. One Score per pair with three levels that map directly to actions: `different` (leave unlinked), `unclear` (a person should look), `same` (merge). The decision is the most likely level, so there is no threshold to tune.

```bash
jev match (--pairs <ref> | --left <ref> --right <ref> | --dedupe <ref>) [--kind <text>] [options]
```

| Option | Meaning |
| --- | --- |
| `-p, --pairs <ref>` | JSON: `[["a","b"], ...]` or `[{"left": ..., "right": ...}]`. Items are strings or `{id, text}`. |
| `--left <ref> --right <ref>` | Two JSON item lists; every left item is compared with every right item |
| `-d, --dedupe <ref>` | One JSON item list; every pair within it is compared |
| `-k, --kind <text>` | What the records are, e.g. `"customer contacts"`. Sharpens the question. |
| `--fail-on <list>` | Exit 2 when any pair is `same`, `unclear`, or `different` |

Limit: 200 pairs per call, sent in groups of 50. For large sets, block first (by postcode, name prefix, category) and match within blocks.

```text
$ jev match --dedupe @contacts.json --kind "customer contacts"
Decision   Conf  Left                      Right
---------  ----  ------------------------  ------------------------
same       0.91  c_1042                    c_2210
unclear    0.48  c_1042                    c_3187
different  0.97  c_2210                    c_3187

1 same · 1 unclear · 1 different
```

### `jev route`

Picks a handler for a request and fills that handler's arguments from closed sets, all in one call. Argument questions for every handler are asked speculatively in the same request; only the chosen handler's answers are returned. A `none` handler is always available so the model can decline.

```bash
jev route [request] (--handlers <list> | --handlers-json <ref>) [options]
```

| Option | Meaning | Default |
| --- | --- | --- |
| `-H, --handlers <list>` | Handlers without arguments: `refund:money back,cancel:stop an order,support` | |
| `--handlers-json <ref>` | Handlers with arguments, see below | |
| `-i, --instructions <text>` | Replace the default routing question | |
| `--min-confidence <p>` | Below this confidence the route is `review` | `0.6` |
| `--state-json` | Parse the request as JSON | |
| `--fail-on <list>` | Exit 2 on `review` or `unrouted` (no handler fits) | `none` |

Handlers JSON: each value is a description string, `null`, or `{"description", "args"}`. Each arg is one of:

```json
{"type": "choice", "options": ["full", "partial"], "instructions": "optional"}
{"type": "choice", "options": {"full": "entire order", "partial": "some items"}}
{"type": "noul", "instructions": "Does the customer need this immediately?"}
{"type": "score", "levels": ["calm", "annoyed", "furious"]}
```

Result: `handler` (or `null`), `confidence`, `action` (`auto`, `review`, `none`), `probabilities` over handlers, and `args` with a typed `value` per argument (`null` when the request does not say).

```text
$ jev route "cancel order 4411 and refund the whole thing, today please" --handlers-json @handlers.json
refund  conf 0.87  auto
[refund 0.90, cancel 0.08, support 0.01, none 0.01]
  scope = full  conf 0.93
  urgent = yes  p 0.88
```

### `jev batch`

Runs `classify`, `screen`, `extract`, `ask`, `verify`, `find`, `rerank`, or `route` over many rows with a concurrency pool. One JSON record per row, in input order.

```bash
jev batch <command> --input <ref> [--output <path>] [--concurrency <n>] [--fail-fast] -- <flags for that command>
```

| Option | Meaning | Default |
| --- | --- | --- |
| `-i, --input <ref>` | `@file` or `-`. Plain lines (one text per line) or JSONL objects with `text` (or `state`) and an optional `id`. Extra fields are passed through as `meta`. | required |
| `-o, --output <path>` | Write records to a file instead of stdout | stdout |
| `--concurrency <n>` | Parallel requests | `4` |
| `--fail-fast` | Stop scheduling new rows after the first error | off |

Everything after `--` is passed to the sub-command exactly as you would type it, minus the text argument, which each row supplies. For `verify` the row is a claim and `--evidence` is shared; for `find` the row is a query and the candidates are shared.

Record shape: `{"index", "id", "ok", "failed", "result" | "error", "meta"}`. `failed` means the sub-command's `--fail-on` matched for that row. A summary line goes to stderr. Exit code is `1` if any row errored, `2` if any row matched `--fail-on`, else `0`.

```bash
jev batch classify -i @tickets.txt -- --labels billing,technical,sales --other
jev batch screen -i @pages.jsonl -o results.jsonl --concurrency 8 -- --purpose "extract pricing"
jev batch verify -i @claims.txt -- --evidence @spec.md --fail-on contradicted,unsupported
```

### `jev compact`

Shrinks an agent transcript without summarizing anything. Most compaction asks an LLM to summarize old turns, and a summary can silently lose a file path, an exact error, or a constraint. `jev compact` instead shows Jev the whole conversation and asks, for every tool call outside the pinned first and newest messages, two yes/no questions: does knowing this call was made still matter, and does its full output still need to stay verbatim. Stale results are cut to a short head plus a note, stale calls are removed, and everything else is returned as it was. User and assistant text is never touched.

```bash
jev compact [transcript] [options]
```

| Input | Form |
| --- | --- |
| Claude Code session log | `@~/.claude/projects/<project>/<session>.jsonl` |
| Messages JSON | `[{"role","text","toolUses":[{"tool_use_id","tool","input"}],"toolResults":[{"tool_use_id","text"}]}]` |

| Option | Meaning | Default |
| --- | --- | --- |
| `-g, --goal <text>` | The ongoing task, so Jev knows what still matters | last three user prompts |
| `--keep-threshold <p>` | Keep a call or result when Jev's probability is at least this | `0.5` |
| `--preserve-recent <n>` | Newest messages never touched (the first is always kept) | `6` |
| `--max-state-tokens <n>` | Budget for the history sent to Jev; fitted in stages, never summarized | `25000` |
| `--max-request-tokens <n>` | Budget for history plus one batch of questions; more questions mean more requests | `30000` |
| `--truncate-head <n>` | Characters kept from a dropped result before its note | `300` |
| `--min-reduction <p>` | Below this ratio the result is flagged `worth_it: false` | `0.25` |
| `-o, --out <path>` | Write the compacted transcript as messages JSON | |
| `--fail-on <list>` | Exit 2 on `low-reduction` | `none` |

```text
$ jev compact @session.jsonl --out compacted.json
61% smaller  528 → 341 messages · 1,204,311 → 470,902 chars
209 tool calls: 58 kept · 71 results truncated · 77 calls dropped · 3 pinned · state ~24944 tokens (old messages collapsed) in 5 request(s), 2140 ms

Call  Tool    Action    P(call)  P(result)
----  ------  --------  -------  ---------
t1    Bash    truncate  0.91     0.12
t2    Read    drop      0.08     0.03
...
```

The same procedure runs in-session through the Claude Code plugin's hook, replacing the built-in compaction summary. See [Claude Code plugin](#claude-code-plugin). Adapted from [fast-jev-compaction](https://github.com/tamaratran/fast-jev-compaction).

### `jev models`

Lists the models your account can use, with release dates. Requires the TypeSafe provider.

### `jev auth`

Keeps the API key out of shell profiles and process environments.

| Subcommand | Does |
| --- | --- |
| `jev auth login [openrouter]` | Prompts for the key with hidden input and stores it. With `--key-stdin`, or when piped, reads one line from stdin, so password managers work: `op read "op://Private/TypeSafe/credential" \| jev auth login --key-stdin` |
| `jev auth status` | Where each provider's key comes from: `env`, `keychain`, `file`, or `none`. Exit 1 if none. |
| `jev auth logout [--all]` | Remove a stored key |

Storage: macOS Keychain (service `jevctl`), Linux Secret Service through `secret-tool`, otherwise `~/.config/jev/credentials.json` (`0600`). Force one with `JEV_CREDENTIAL_STORE=file` or `keychain`; point the file elsewhere with `JEV_CREDENTIALS`. Resolution order at run time is the environment variable first, then the store; `JEV_NO_STORED_CREDENTIALS=1` ignores the store (useful in CI). The Claude Code hook cannot read the keychain, so for in-session compaction use the `settings.json` `env` entry or the plugin's sensitive `apiKey` option.

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
  "find": { "topK": 5, "found": 0.7, "absent": 0.35 },
  "classify": { "minConfidence": 0.6, "threshold": 0.5 },
  "extract": { "minConfidence": 0.6 },
  "batch": { "concurrency": 4 },
  "rerank": { "topK": 10, "min": 0.5 },
  "route": { "minConfidence": 0.6 },
  "compact": { "keepThreshold": 0.5, "preserveRecent": 6, "maxStateTokens": 25000, "maxRequestTokens": 30000, "truncateHead": 300, "minReduction": 0.25 }
}
```

### Environment variables

| Variable | Purpose |
| --- | --- |
| `TYPESAFE_API_KEY` | TypeSafe API key. Optional when stored with `jev auth login`; takes precedence when set. |
| `TYPESAFE_BASE_URL` | Alternate TypeSafe endpoint, for proxies or testing |
| `OPENROUTER_API_KEY` | OpenRouter key (`sk-or-...`). Used when no TypeSafe key is present. |
| `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` | Cloudflare Workers AI. Used when no other key is present. `JEV_CLOUDFLARE_API_TOKEN` takes precedence over `CLOUDFLARE_API_TOKEN` if you need separate credentials. |
| `JEV_PROVIDER` | Force `typesafe`, `openrouter`, or `cloudflare` |
| `JEV_MODEL` | Default model |
| `JEV_TIMEOUT_MS` | Default timeout |
| `JEV_FORMAT` | Default output format, `text` or `json` |
| `JEV_CONFIG` | Config file path |
| `JEV_CREDENTIALS` | Credentials file path (file store) |
| `JEV_CREDENTIAL_STORE` | `auto` (default), `keychain`, or `file` |
| `JEV_NO_STORED_CREDENTIALS=1` | Ignore stored keys; environment only |
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

**Use `batch` for anything over a handful of rows.** It pools requests, keeps input order, and gives you one JSONL line per row to pipe into `jq`.

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
team=$(jev classify @ticket.txt -l billing,technical,sales --other --json | jq -r .label)
```

**Label a whole backlog.**

```bash
jev batch classify -i @issues.jsonl -o labeled.jsonl -- -l bug,feature,question,docs --other --fail-on review
jq -r 'select(.failed) | .id' labeled.jsonl      # the ones a human should look at
```

**Pull structured fields from every email in a folder.**

```bash
for f in inbox/*.eml; do jq -n --arg id "$f" --arg text "$(cat "$f")" '{id:$id,text:$text}'; done \
  | jev batch extract -i - -- --want sender=email:the sender --want reply_by=date:the reply deadline --want amount
```

**Rerank search results before answering from them.**

```bash
my-search "$q" --json | jev rerank "$q" -c - --min 0.6 --json | jq '.kept'
```

**Dedupe a contact export, sending only the unclear pairs to a person.**

```bash
jev match --dedupe @contacts.json --kind "customer contacts" --json \
  | jq -r '.results[] | select(.decision=="unclear") | "\(.left) ~ \(.right)"' > needs-review.txt
```

**Route chat messages to typed handlers in a bot.**

```bash
jev route "$message" --handlers-json @handlers.json --fail-on unrouted --json | jq '{handler, args}'
```

**Compact a Claude Code session offline and inspect what would go.**

```bash
jev compact @~/.claude/projects/-Users-me-repo/$SESSION.jsonl --json | jq '.decisions[] | select(.action != "keep") | {id, tool, action}'
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
| `No credentials found` | Run `jev auth login`, or export `TYPESAFE_API_KEY`; `jev auth status` shows what was found |
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

## Claude Code plugin

This repo ships a [Claude Code](https://claude.com/claude-code) plugin that teaches Claude when and how to use `jev`, plus four slash commands: `/jev:verify`, `/jev:screen`, `/jev:find`, `/jev:ask`.

```bash
npm install -g jevctl
claude plugin marketplace add Nasrallah-AL/jev-cli
claude plugin install jev@jev-cli
```

Once installed, Claude will screen fetched pages before reading them, fact-check its own summaries against sources, and use `jev find` instead of grepping when a query is about meaning. See [plugin/README.md](plugin/README.md).

**Compaction hook.** The plugin also ships a function hook that replaces Claude Code's compaction summary with `jev compact`'s verbatim procedure, and requests compaction when context usage reaches 60%. Function hooks are early access, so enable them and provide the key in `~/.claude/settings.json`:

```json
{ "env": { "CLAUDE_CODE_ENABLE_FUNCTION_HOOKS": "1", "TYPESAFE_API_KEY": "<your key>" } }
```

The hook is on by default once installed; set the plugin option `compaction` to `false` to turn it off, or `compactAtPercent` to `0` to leave timing to Claude Code. On every compaction you get a toast with the reduction and decision counts, or a fallback notice when Jev is unavailable or the reduction is too small. Details and all options: [plugin/hooks/README.md](plugin/hooks/README.md).

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
