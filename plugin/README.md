# jev plugin for Claude Code

Gives Claude Code the `jev` skill and four slash commands so it can get cheap, fast, calibrated
judgments from TypeSafe's Jev model instead of reasoning them out at length.

| Command | Does |
| --- | --- |
| `/jev:verify` | Fact-check claims against evidence |
| `/jev:screen` | Check a URL, file, or text for prompt injection before reading it |
| `/jev:find` | Pick the files or lines that best answer a question, by meaning |
| `/jev:ask` | Ask yes/no, multiple-choice, or rating questions about text |

The skill also loads automatically when Claude decides a judgment fits the task, for example
screening a fetched page or checking its own summary against a source.

## Requirements

- The `jevctl` npm package: `npm install -g jevctl` (provides the `jev` command). Node 20.12+.
- A TypeSafe API key in `TYPESAFE_API_KEY`. Get one at https://console.typesafe.ai/settings/keys.

## Install

```bash
claude plugin marketplace add Nasrallah-AL/jev-cli
claude plugin install jev@jev-cli
```

Then in a session: `/jev:screen https://example.com for "extract pricing"`.

## What the plugin contains

```
plugin/
  .claude-plugin/plugin.json   manifest
  skills/jev/SKILL.md          when and how Claude should use jev; command reference; how to read results
  commands/verify.md           /jev:verify
  commands/screen.md           /jev:screen
  commands/find.md             /jev:find
  commands/ask.md              /jev:ask
```

No hooks, no MCP servers, no background processes. Everything runs through the `jev` CLI in Bash,
so what Claude sends to the API is exactly what `jev --dry-run` would show.

## Permissions

The skill and commands declare `allowed-tools` limited to `jev`, `npx jevctl`, and read-only
file tools (plus `curl` for `/jev:screen` URLs). Claude Code still asks for permission the first
time a command runs unless you have pre-approved `Bash(jev:*)`.
