# pi-profile

Startup instruction profiles for [Pi](https://github.com/earendil-works/pi).

Choose a purpose when starting a new interactive conversation or using `/new`:

1. **Research** — research and source-backed documents or tables.
2. **Specification** — requirements, constraints, and acceptance criteria.
3. **Development** — code, design, and verification.
4. **Chore** — organization, routine tasks, and drafts.
5. **Other** — no additional instructions (also the Escape fallback).

The included instructions and selector text are Japanese. Edit the catalog and Markdown files to customize them.

## Install

Requires **Pi 1.0.2** (tested) and **Node 26.10.0 or newer**. Other Pi and Node versions have not been validated.

```sh
pi install git:github.com/Papillon6814/pi-profile
```

Restart Pi to load the extension. For a local checkout:

```sh
pi install /path/to/pi-profile
```

Review the source before installation: Pi extensions execute code. Do not enable this package alongside the older `my-pi/extensions/startup-profile/index.ts`; exclude the old entry first to avoid duplicate selectors.

This is **not an account switcher**. It does not change authentication, models, thinking levels, skills, tools, MCP, or permissions.

## Conversation behavior

A selected profile is fixed for the conversation. Its ID, label, and literal instructions are saved as a session snapshot. Resume, reload, fork, and clone restore that snapshot even if the profile definition changes or disappears. Old conversations without a snapshot use Other.

The snapshot is registered immediately and written with the first user message; exiting without sending a message creates no new session file. `--no-session` does not persist the selection.

New print, JSON, and RPC sessions use Other without a selector. Existing saved sessions restore their selected profile in those modes.

There is no mid-conversation switch or profile CLI flag.

## Customize

Edit `extensions/startup-profile/profiles/catalog.json` and place instruction Markdown in the same directory:

```json
{"id":"writing","label":"Writing","description":"Draft and edit text","instructionsFile":"writing.md"}
```

Catalog order is display order. IDs must be unique lowercase alphanumeric/hyphen identifiers. The fallback ID `standard` has no instruction file. Absolute paths, parent traversal, and symlinks escaping the catalog directory are rejected.

Instructions apply only to new conversations. **Never put credentials or secrets in a profile:** the literal text is saved in the conversation and may be exposed in exports or shares. Profiles should not weaken common safety rules or project instructions.

The legacy `secretary.md` is retained but is not offered for new conversations.

## Development

```sh
npm ci --ignore-scripts
npm test
npm run typecheck
python3 -m unittest discover -s scripts/tests -v
python3 scripts/test-startup-profile-cli.py --pi "$(command -v pi)"
```

CLI tests use disposable HOME/configuration, synthetic credentials, a loopback-only model, and PTYs. They do not use real accounts or an external model API. Evidence is written to ignored `.test-evidence/cli/`. The PTY harness supports macOS/Linux, not Windows.

The default run skips **one external compatibility case**, explicitly reporting it as skipped. Run it separately with existing extension paths:

```sh
python3 scripts/test-startup-profile-cli.py --pi "$(command -v pi)" \
  --compatibility-only \
  --plan-extension /path/to/pi-plan-mode/plan-mode.ts \
  --omp-extension /path/to/my-pi/extensions/omp-modes.ts
```

Both paths are required; no extension is downloaded. This case loads external code into the synthetic environment, so review those extensions first. A negative control should exit nonzero:

```sh
python3 scripts/test-startup-profile-cli.py --case startup_select --without-extension
```

See [the detailed Japanese guide](docs/startup-profiles.md).

## License

MIT © 2026 Papillon6814.
