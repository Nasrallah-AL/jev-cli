# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/). Pre-1.0 minor versions may include
breaking changes to flags or JSON output; they are called out below.

## [Unreleased]

## [0.1.0] - 2026-09-18

Initial release.

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
