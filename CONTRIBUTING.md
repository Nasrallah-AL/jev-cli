# Contributing

Thanks for helping improve jev-cli. Issues and pull requests are welcome.

## Setup

```bash
git clone https://github.com/Nasrallah-AL/jev-cli
cd jev-cli
npm install
npm run check
```

Node.js 20.12 or newer. No API key is needed for `npm run check`.

## Workflow

- `npm run dev -- <args>` runs the CLI from source with tsx.
- `npm run typecheck`, `npm run lint`, `npm test` are what CI runs. `npm run check` runs all three.
- `npm run lint:fix` applies Biome formatting and safe fixes.
- `npm run test:e2e` runs live tests against the TypeSafe API and needs `TYPESAFE_API_KEY`.

## Layout

```
src/
  cli.ts          commander program, global flags, error handling, exit codes
  context.ts      resolves config + output options + provider for a command
  config.ts       config file, env, and flag resolution (zod)
  provider.ts     TypeSafe / OpenRouter / Cloudflare transports -> AskFn
  input.ts        @file, stdin, JSON list/item parsing
  output.ts       tables, colors, JSON emit
  lib.ts          pure helpers shared by commands (ids, thresholds, ranking)
  core/           one file per judgment; pure functions that take an AskFn
  commands/       flag parsing and text rendering per command
test/
  commands/<name>.test.ts   one file per command: "<name>: core" (pure logic with a fake AskFn)
                            and "<name>: cli" (spawns dist/cli.js against the fake API)
  cli-global.test.ts        help, version, errors, credentials, models, config
  lib/config/input/provider.test.ts   shared modules
  helpers/fake-api.ts       local stand-in for api.typesafe.ai
  helpers/fake-ask.ts       in-process fake provider for core tests
  helpers/cli.ts            cliHarness(): spawn runner + hooks
  e2e.test.ts               live API, skipped without a key
```

Adding a command: `src/core/<name>.ts` (pure, takes `AskFn`), `src/commands/<name>.ts` (flags, rendering, and a
`prepare<Name>Batch` if it takes one text input), register it in `src/cli.ts` and `BATCHABLE` in
`src/commands/batch.ts`, export from `src/index.ts`, add `test/commands/<name>.test.ts` with both describes,
document it in README and `plugin/skills/jev/SKILL.md`.

Keep question design (instructions and criteria) in `src/core/`. Keep policy (thresholds, exit codes) in code, not in prompts. Anything a script may depend on, such as JSON field names and exit codes, is a public contract: note changes in `CHANGELOG.md`.

## Pull requests

- One change per PR, with tests. CLI-visible changes get a case in the command's `test/commands/<name>.test.ts`.
- Update `README.md` for new flags or output fields, and add an entry under `Unreleased` in `CHANGELOG.md`.
- CI must pass: typecheck, lint, tests on Node 20 and 22.

## Releasing

Maintainers: bump the version in `package.json`, move `Unreleased` notes to a new version heading in `CHANGELOG.md`, commit, then tag `vX.Y.Z` and push the tag. The release workflow publishes to npm via Trusted Publishing (GitHub OIDC, no stored token) with provenance, and creates a GitHub release from the CHANGELOG section.
