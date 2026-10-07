# Profile package launcher

The launcher is an optional entrypoint before normal Pi. It does not replace Pi's CLI, disable network activity, switch provider accounts, or sandbox extensions.

## Requirements

- Node 26.10.0 or newer; macOS/Linux.
- npm-installed Pi **1.0.4**. Other versions/layouts fail with a diagnostic; the standalone startup-profile extension retains its Pi 1.0.2 compatibility.
- The launcher executable and the common `pi-profile` registration must refer to the same package checkout/install. Two physical copies would run two selectors.

## Start

```sh
pi-profile launch --
pi-profile launch --profile developer -- --print "Review the diff"
pi-profile launch -- --continue
pi-profile launch -- --resume
pi-profile launch -- --session /path/to/session.jsonl
```

New terminal conversations select a Profile before Pi starts. Enter confirms; arrows move; Escape chooses Other; Ctrl-C cancels. New print/JSON/RPC conversations use Other unless `--profile` is explicit. Resume restores the saved Profile; old conversations without a snapshot use Other. A missing/disabled saved Profile is not recreated; restore its definition or deliberately use the old entrypoint.

`/new` keeps the launched Profile. `/resume` and RPC session switches reject a different Profile before tearing down the current conversation. Restart through the launcher to switch Profiles. Fork/clone/tree retain the instruction snapshot. As in Pi, these instructions may appear in exported sessions: do not put secrets in them.

`PI_PROFILE_PI_BIN` selects the normal Pi executable. `PI_PROFILE_DIR` keeps its existing meaning. The launcher does not change `PI_CODING_AGENT_DIR`, authentication, models, thinking, MCP, or project trust.

## Assign packages

Use a separate `packages.json` in a personal Profile folder; the internal Development ID is `developer` even though its folder is `development`.

```json
{"version":1,"packages":["npm:example-pi-tools@1.0.0"]}
```

The source above is an example, not an installed dependency. npm/Git/local sources are resolved by Pi's standard PackageManager, with the same missing-package acquisition and version/ref behavior. Fixed versions are available, not mandatory. The launcher adds no `--offline` or blanket install prohibition. Runtime extensions and dependency installers run with ordinary user OS permissions.

```sh
pi-profile packages list --profile developer
pi-profile packages add --profile developer npm:example-pi-tools@1.0.0
pi-profile packages add --profile developer npm:example-pi-tools@1.1.0 --replace
pi-profile packages remove --profile developer npm:example-pi-tools
pi-profile packages install --profile developer
pi-profile packages update --profile developer
```

Add/remove edit only the selected declaration. Remove unassigns; it does not delete caches. Source identity ignores npm version/Git ref. Replacing an existing assignment requires `--replace`. A foreign declaration lock is not force-removed. Declaration symlinks are rejected. Relative local sources resolve from the Profile folder.

Dedicated managed package data is under `~/.pi/profile-packages/<profile-id>/`; no auth data is copied there. Only assigned sources are resolved as dedicated roots: project auto-discovery is left to normal Pi and its trust decision. A conflicting common assignment is rejected rather than falsely described as Profile-only.

The source set is fixed for the process. Restart after changing assignments. The package's own content/version behavior is Pi's standard behavior, not immutable-code isolation.

## Reload and recovery

Reload re-resolves dedicated sources using the standard manager, then ordinary Pi reloads its resources. **Reload failure follows Pi's behavior; it is not guaranteed to stop subsequent conversation.** In particular, RPC may continue after a factory load failure without an extension-error notification. Restart to verify/recover a problematic package. Initial extension-load failure is rejected by normal Pi startup.

Private launch metadata excludes forwarded command arguments such as API keys, is mode 0600, and is removed only while its ownership/nonce still match. It is not an authorization token or OS security boundary. SDK child sessions cannot claim the parent's launch binding; child extension/tool selection follows pi-subagents' existing rules, not automatic inheritance of every dedicated package.

## Account launcher integration — separate rollout

The reviewed dotfiles change connects `pi-account` to `pi-profile launch -- "$@"`, retaining `pi-kuno`, `pi-muu`, and `pi-rbx` names and their existing auth/link preparation. This repository does not apply that change automatically.

After separate approval, build the stable package, register a `pi-profile` bin pointing to the same source as Pi's common registration, and apply the reviewed account launcher source. Preserve the old launcher and registration for recovery. Do not deploy a soon-to-be-removed feature worktree as the permanent bin source.

```sh
# Explicitly use the old account entrypoint after rollout:
PI_PROFILE_LAUNCHER=0 pi-muu
```

Plain `pi` retains the original in-Pi Profile selector. A missing new bin fails visibly; there is no silent fallback.

## Verification

```sh
npm run build
npm test
npm run typecheck
python3 -m unittest discover -s scripts/tests -v
python3 scripts/test-profile-launcher-cli.py --pi /path/to/pi --launcher dist/src/cli.js
```

Tests use synthetic HOME/accounts, fake installers, a loopback model and PTYs. Real accounts and external model APIs are not exercised. The existing standalone CLI suite separately validates Pi 1.0.2/1.0.4. Pass existing subagent/Plan/omp extension paths explicitly for integrations. Some fixtures deliberately pass offline for isolation; tests separately verify that the product does not add it and that a loopback prompt works without it. This is not proof that every remote provider catalog endpoint is reachable.
