# pi-profile

Startup instruction profiles for [Pi](https://github.com/earendil-works/pi).

Choose a purpose when starting a new interactive conversation or using `/new`:

1. **Research** — research and source-backed documents or tables.
2. **Specification** — requirements, constraints, and acceptance criteria.
3. **Development** — code, design, and verification.
4. **Chore** — organization, routine tasks, and drafts.
5. **Other** — no additional instructions (also the Escape fallback).

The included instructions and selector text are Japanese. Each profile has its own folder, optional skills, and optional namespaced subagents.

## Install

Requires **Pi 1.0.2 or newer** (tested on 1.0.2 and 1.0.4) and **Node 26.10.0 or newer**. Other Pi and Node versions have not been validated.

```sh
pi install git:github.com/KendrickMalar/pi-profile
```

Restart Pi to load the extension. For a local checkout:

```sh
pi install /path/to/pi-profile
```

Review the source before installation: Pi extensions execute code. Do not enable this package alongside the older `my-pi/extensions/startup-profile/index.ts`; exclude the old entry first to avoid duplicate selectors.

This is **not an account switcher**. It preserves parent authentication, models, thinking levels, tools, MCP, permissions, and common skills/agents. A selected profile can add skills and `pi-subagents` agents for this conversation.

## Conversation behavior

A selected profile is fixed for the conversation. Its ID, label, and literal instructions are saved as a session snapshot. Resume, reload, fork, and clone restore that snapshot even if the profile definition changes or disappears. Old conversations without a snapshot use Other.

The snapshot is registered immediately and written with the first user message; exiting without sending a message creates no new session file. `--no-session` does not persist the selection.

New print, JSON, and RPC sessions use Other without a selector. Existing saved sessions restore their selected profile in those modes.

There is no mid-conversation switch or profile CLI flag.

## Customize

Manage one folder per personal profile under **`~/.pi/agent/profiles/`**. The package's `extensions/startup-profile/profiles/` contains samples only; it is not an active configuration source.

Create the personal directory once and copy the five sample folders (`research`, `specification`, `development`, `chore`, `standard`) from the package. An empty `catalog.json` is optional. Keep their IDs unchanged. Inspect any existing destination first: do not overwrite or merge existing user definitions. Pi does not create or copy profiles automatically. Missing or empty personal roots use Other; deleting a personal profile does not bring back its sample.

To use another root for an invocation:

```sh
PI_PROFILE_DIR="$HOME/my-profiles" pi
# A literal ~/ prefix is also accepted:
PI_PROFILE_DIR='~/my-profiles' pi
```

Only absolute paths and `~/` paths are supported. Unset or empty `PI_PROFILE_DIR` uses the default; invalid relative/control-character values use Other with a warning and never fall back to another root. Account-specific `PI_CODING_AGENT_DIR` does not change this default: profiles are shared by accounts in the same HOME unless explicitly overridden. Restart/reload to reread definitions. Package updates never overwrite personal files.

```text
research/
  profile.json
  instructions.md
  skills/source-check/SKILL.md
  agents/investigator.md
```

```json
{"id":"research","label":"Research","description":"Research sources","order":10,"enabled":true}
```

`instructions.md` is required except for Other (`id: standard`, no instructions). Optional `skills/` and `agents/` add resources to the common setup. Set `enabled: false` to remove a profile from new selection. Profiles sort by `order` (default 100), then ID. Keep existing IDs when renaming folders; Development uses `developer`.

Skills use Agent Skills `SKILL.md`. Normally discovered common skills win same-name collisions. Skills contributed by other extensions follow Pi's extension discovery order (first discovered wins); child-selected skills always use the parent's final winner. Child-selected skill names must match their directory (or standalone Markdown basename), or the agent is rejected with a diagnostic.

Agent Markdown uses YAML frontmatter:

```yaml
---
name: investigator
description: Check research evidence
tools: read, bash
skills: source-check
---
Check sources and separate facts from assumptions.
```

Research registers this as **`profile.research.investigator`**, not `investigator`. Keep the `profile.` prefix reserved: do not create common agents or aliases with the same complete names. Complete-name collisions with common definitions are not automatically recovered. Runtime agents require a compatible installed `pi-subagents` (tested with 0.76.1); its absence does not prevent profiles or skills from loading.

Supported agent fields: `name`, `description`, `tools`, `skills`, `model`, `thinking`, `systemPromptMode`, `inheritProjectContext`, `inheritGlobalContext`, `inheritSkills`. Unknown fields are rejected. Defaults: append prompt, retain project/global instructions, do not inherit the entire skills catalog. Explicit `skills` select common or profile skills. Tool names do not automatically load extension providers. No automatic child launch or nested-agent registration is provided.
Path-like `tools` entries (including `/` or a `.ts`/`.js` suffix) are rejected: they would otherwise load arbitrary extension code through pi-subagents.

Profile instructions remain saved in the conversation. Additional resources are read from current files on resume/reload; missing or disabled profiles retain saved instructions without their additional resources. Changes to referenced scripts/files are not a fully immutable snapshot or sandbox.

Legacy `catalog.json` definitions still work. The file is optional: folder-only profiles need no catalog, and its absence produces no warning. Invalid JSON, unreadable catalogs, and dangling catalog symlinks still produce warnings. Folder definitions take precedence over the same legacy ID, including disabled definitions. Other is always available as a safe fallback. External symlink/path escapes are rejected.

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

The default run skips four optional integration cases: Plan/omp compatibility plus three real-subagent cases (base and both common-extension load orders). Pass the existing extension paths to run them; nothing is downloaded.

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

Real subagent integration (foreground/background children against the loopback model):

```sh
python3 scripts/test-startup-profile-cli.py --case profile_subagent_resources \
  --subagents-extension /path/to/pi-subagents/index.js
```

See [the detailed Japanese guide](docs/startup-profiles.md).

## License

MIT © 2026 KendrickMalar.
