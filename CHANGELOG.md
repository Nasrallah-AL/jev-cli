# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/). Pre-1.0 minor versions may include
breaking changes to flags or JSON output; they are called out below.

## [Unreleased]

## [0.2.0] - 2026-09-18

### Added

- `jev classify`: single-label (Choice), multi-label (`--multi`, one Noul per label), and hierarchical (`--taxonomy`, greedy level-by-level) classification with `--other` escape, `--min-confidence`, and `--fail-on review,other,unlabeled`.
- `jev extract`: regex-candidate extraction with builtin fields (`email`, `phone`, `url`, `amount`, `date`, `percent`, `number`) and custom `name=/regex/:description` fields; Jev selects the span, code normalizes it. No API call when nothing matches.
- `jev batch <command>`: run `classify`, `screen`, `extract`, `ask`, `verify`, or `find` over plain-line or JSONL input with a concurrency pool; JSONL records in input order, `--output`, `--fail-fast`, exit 1 on row errors and 2 on matched `--fail-on`.
- `jev rerank`: independent relevance score (Noul) per candidate, sorted, with `--min` keep threshold, `--criteria`, and `--fail-on empty`.
- `jev match`: same/unclear/different decision per pair from a three-level Score; `--pairs`, `--left/--right` cross product, `--dedupe`; chunked requests up to 200 pairs.
- `jev route`: handler Choice with a built-in `none` plus speculative typed argument questions (choice/noul/score) per handler in one request; `-H` shorthand or `--handlers-json`; `--fail-on review,unrouted`.
- `batch` also accepts `rerank` and `route`.
- `jev compact`: verbatim context compaction for agent transcripts (Claude Code session `.jsonl` or messages JSON). Jev decides per tool call whether the call and its result still matter; nothing is summarized. `--out`, `--goal`, thresholds, `--fail-on low-reduction`. Vendors [fast-jev-compaction](https://github.com/tamaratran/fast-jev-compaction) (MIT) under `src/vendor/compaction/`.
- Claude Code plugin: `session.compact` / `turn.complete` function hook that replaces the built-in compaction summary with the same procedure; `userConfig` options for thresholds and a `compaction` master switch. Requires `CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1`.
- Config sections `classify`, `extract`, `batch`, `rerank`, `route`.
- Output formats: `--format json|jsonl|md|csv|tsv` (shortcuts `--json`, `--md`) on every command, `--pluck <path>` to print one value, `JEV_FORMAT` and `config.format` defaults. `batch --format json` collects an array; `md|csv|tsv` print a summary table. Rerank's blank column is now named `Keep`.
- Docs: README reduced to install, first run, a command index, and shared conventions; one page per command under `docs/`, plus configuration, recipes, guidelines, library, and troubleshooting pages.
- `jev auth login|status|logout`: store the API key in the macOS Keychain, Linux Secret Service, or a `0600` credentials file instead of exporting it. Keys resolve env first, then the store. `JEV_CREDENTIAL_STORE`, `JEV_CREDENTIALS`, `JEV_NO_STORED_CREDENTIALS`. `jev config` reports the key source.
- Claude Code plugin (`plugin/`) with the `jev` skill and `/jev:verify`, `/jev:screen`, `/jev:find`, `/jev:ask` commands; installable via `claude plugin marketplace add Nasrallah-AL/jev-cli`.

### Changed

- `match` results carry `left_text` and `right_text` alongside the ids, and the text table shows `id: text` so string pairs are identifiable.

### Fixed

- A response with missing, mistyped, or absent answers is now an error (exit 1, `Malformed response from <model>`). Previously `screen` printed `PASS`, `find` reported all candidates at 0.00, and `verify` marked claims `unknown` with exit 0.
- `find --lines` / `rerank --lines`: ids are now the real 1-based source line numbers (`L7` is line 7 of the file), not the index among non-empty lines.
- `find`: `--absent` above `--found` is rejected instead of silently producing inconsistent verdicts.
- `compact`: messages JSON may omit `text` and `toolUses` (a tool-result-only message needs neither).
- Text and Markdown footers print `no API call made` instead of an empty model and provider when no request was sent.
- `extract --help` quotes the descriptions-with-spaces examples so they paste into a shell.
- `extract`: the `number` builtin no longer reads a hyphen glued to a word as a minus sign (`INV-20931` → `20931`) and no longer captures a trailing comma.
- `config set` rejects keys the schema does not know instead of writing them silently.
- `--claims @file` containing a JSON object (not an array) is an error rather than one literal claim; a blank claim is rejected before any request.
- `--pluck` with a path that matches nothing exits 1 instead of printing an empty line (`batch` rows stay lenient).
- `ask`: a shorthand question id used twice is an error instead of silently overwriting the first question.
- Keys are masked the same way from every source (`…` plus the last four characters, or `********` for short keys); previously file-stored keys showed their first four characters.

## [0.1.0] - 2026-09-18

Initial release, published to npm as `jevctl`. The installed command is `jev`.

### Added

- `jev verify`: claims versus evidence with `supports` / `contradicts` / `says_nothing` distributions, confidence, per-claim evidence attribution, and an auto-versus-review gate.
- `jev screen`: injection, substance, and relevance probabilities with an advisory `pass` / `review` / `block` / `skip` recommendation.
- `jev find`: semantic ranking of up to 250 candidates from JSON, files, or lines, plus an existence check.
- `jev ask`: raw System One passthrough with `--questions` JSON or `--noul` / `--choice` / `--score` shorthands.
- `jev models`: list account models.
- `jev config`: show, path, init, set, unset, reset; XDG-aware config file with env and flag overrides.
- Providers: TypeSafe direct (default), OpenRouter Decisions, Cloudflare Workers AI.
- `--json` output, `--dry-run` request preview, `--fail-on` exit-code policies (exit 2), `NO_COLOR` support.
- Programmatic exports for embedding the same judgments in Node scripts.
- Test suite: unit tests, provider transport tests with mocked fetch, CLI tests against a local fake TypeSafe API, and optional live e2e tests.

[Unreleased]: https://github.com/Nasrallah-AL/jev-cli/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/Nasrallah-AL/jev-cli/releases/tag/v0.1.0
