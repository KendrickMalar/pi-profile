import test from "node:test";
import assert from "node:assert/strict";
import extension from "../../extensions/startup-profile/index.ts";
import { fileURLToPath } from "node:url";
import { cpSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeLaunchContext } from "../../src/launch-context.ts";

type CustomComponent = {
  render(width: number): string[];
  handleInput?(data: string): void;
  invalidate(): void;
  dispose?(): void;
};

function harness(choice: string | null | undefined = "[developer] Development — コード・設計・検証を中心に支援", restore: unknown[] = [], root?: string) {
  const handlers: Record<string, Function> = {};
  const entries: any[] = [...restore];
  const notices: any[] = [];
  const statuses: any[] = [];
  const components: CustomComponent[] = [];
  let customs = 0;
  let doneCallbacks = 0;
  let id = "one";
  const tui = { terminal: { rows: 24 }, requestRender() {} };
  const theme = {
    fg: (_color: string, text: string) => text,
    bold: (text: string) => text,
  };
  const keybindings = {
    matches: (data: string, action: string) => ({
      "tui.select.up": "up",
      "tui.select.down": "down",
      "tui.select.confirm": "enter",
      "tui.select.cancel": "escape",
    } as Record<string, string>)[action] === data,
    getKeys: (action: string) => [({
      "tui.select.up": "up",
      "tui.select.down": "down",
      "tui.select.confirm": "enter",
      "tui.select.cancel": "escape",
    } as Record<string, string>)[action]],
  };
  const mount = (factory: Function, resolve: (value: string | undefined) => void) => {
    let component: CustomComponent;
    const done = (value: string | undefined) => {
      doneCallbacks++;
      component.dispose?.();
      resolve(value);
    };
    component = factory(tui, theme, keybindings, done);
    components.push(component);
    return component;
  };
  const choiceId = choice === null ? undefined : choice?.match(/^\[([^\]]+)\]/u)?.[1];
  let customImpl = (factory: Function) => new Promise<string | undefined>(resolve => {
    const component = mount(factory, resolve);
    queueMicrotask(() => {
      if (choiceId === undefined) {
        component.handleInput?.("escape");
        return;
      }
      const order = ["research", "specification", "developer", "chore", "standard"];
      const index = order.indexOf(choiceId);
      for (let current = 0; current < Math.max(0, index); current++) component.handleInput?.("down");
      component.handleInput?.("enter");
    });
  });
  const pi: any = {
    on: (name: string, handler: Function) => { handlers[name] = handler; return () => {}; },
    appendEntry: (customType: string, data: unknown) => entries.push({ type: "custom", customType, data }),
  };
  for (const name of ["setModel", "setThinkingLevel", "setActiveTools", "registerCommand", "registerShortcut", "registerFlag"]) {
    pi[name] = () => assert.fail("out-of-scope API " + name);
  }
  const ctx: any = {
    mode: "tui",
    hasUI: true,
    sessionManager: {
      getEntries: () => entries,
      getSessionFile: () => undefined,
      getSessionId: () => id,
    },
    ui: {
      custom: (...args: any[]) => {
        customs++;
        assert.equal(args.length, 1, "AbortSignal must not be passed as a custom option");
        return customImpl(args[0]);
      },
      notify: (...args: any[]) => notices.push(args),
      setStatus: (...args: any[]) => statuses.push(args),
    },
  };
  extension(pi, root ?? fileURLToPath(new URL("../../extensions/startup-profile/profiles/", import.meta.url)));
  return {
    handlers,
    entries,
    notices,
    statuses,
    components,
    ctx,
    mount,
    get customs() { return customs; },
    get doneCallbacks() { return doneCallbacks; },
    setCustom(implementation: (factory: Function) => Promise<string | undefined>) { customImpl = implementation; },
    setId(next: string) { id = next; },
  };
}

const snapshot = { version: 1, id: "developer", label: "開発", instructions: "RESTORED" };

test("selects and saves snapshot before first agent run", async () => {
  const h = harness();
  await h.handlers.session_start({ reason: "startup" }, h.ctx);
  assert.equal(h.customs, 1);
  assert.equal(h.entries[0].data.id, "developer");
  assert.equal(h.statuses[h.statuses.length - 1][1], "profile:Development");
  const event: any = { systemPrompt: "BASE", systemPromptOptions: { sections: {} } };
  h.handlers.before_agent_start(event, h.ctx);
  assert.match(event.systemPromptOptions.sections.startup_profile, /コード・設計/);
});

for (const [id, label, description, heading] of [
  ["specification", "Specification", "要件・制約・受け入れ条件を整理し、仕様にまとめる", "仕様"],
  ["research", "Research", "情報を調べ、出典付きの資料・表にまとめる", "調査"],
  ["chore", "Chore（雑務）", "整理・定型作業などの雑務を支援", "雑務"],
]) test("selects and applies " + id, async () => {
  const h = harness(`[${id}] ${label} — ${description}`);
  await h.handlers.session_start({ reason: "startup" }, h.ctx);
  assert.equal(h.entries[0].data.id, id);
  assert.equal(h.entries[0].data.label, label);
  const event: any = { systemPrompt: "BASE", systemPromptOptions: { sections: { common: "KEEP" } } };
  h.handlers.before_agent_start(event, h.ctx);
  assert.ok(event.systemPromptOptions.sections.startup_profile.startsWith(`# ${heading}profile`));
  assert.equal(event.systemPromptOptions.sections.common, "KEEP");
});

test("restores removed secretary profile from saved text", async () => {
  const saved = { version: 1, id: "secretary", label: "秘書", instructions: "OLD_SECRETARY_TEXT" };
  const h = harness(null, [{ type: "custom", customType: "startup-profile-state", data: saved }]);
  await h.handlers.session_start({ reason: "resume" }, h.ctx);
  assert.equal(h.customs, 0);
  assert.equal(h.statuses[h.statuses.length - 1][1], "profile:秘書");
  const event: any = { systemPrompt: "BASE", systemPromptOptions: { sections: {} } };
  h.handlers.before_agent_start(event, h.ctx);
  assert.equal(event.systemPromptOptions.sections.startup_profile, saved.instructions);
});

test("cancel chooses standard once and preserves status", async () => {
  const h = harness(null);
  await h.handlers.session_start({ reason: "startup" }, h.ctx);
  assert.equal(h.entries.length, 1);
  assert.equal(h.entries[0].data.id, "standard");
  assert.equal(h.statuses[h.statuses.length - 1][1], "profile:Other");
});

for (const reason of ["startup", "reload", "resume", "fork"]) test("restores immutable snapshot without UI " + reason, async () => {
  const h = harness(undefined, [{ type: "custom", customType: "startup-profile-state", data: snapshot }]);
  await h.handlers.session_start({ reason }, h.ctx);
  assert.equal(h.customs, 0);
  assert.equal(h.entries.length, 1);
  const event: any = { systemPrompt: "BASE", systemPromptOptions: { sections: {} } };
  h.handlers.before_agent_start(event, h.ctx);
  assert.equal(event.systemPromptOptions.sections.startup_profile, "RESTORED");
});

test("new conversation drops previous selection", async () => {
  const h = harness();
  await h.handlers.session_start({ reason: "startup" }, h.ctx);
  h.entries.length = 0;
  h.setId("two");
  h.setCustom(factory => new Promise(resolve => {
    const component = h.mount(factory, resolve);
    queueMicrotask(() => component.handleInput?.("escape"));
  }));
  await h.handlers.session_start({ reason: "new" }, h.ctx);
  assert.equal(h.entries[0].data.id, "standard");
  assert.equal(h.statuses[h.statuses.length - 1][1], "profile:Other");
});

for (const mode of ["print", "json", "rpc"]) test("noninteractive never asks " + mode, async () => {
  const h = harness();
  h.ctx.mode = mode;
  h.ctx.hasUI = false;
  await h.handlers.session_start({ reason: "startup" }, h.ctx);
  assert.equal(h.customs, 0);
});

test("legacy conversation has no selector or new profile entry", async () => {
  const h = harness(undefined, [{ type: "message", message: { role: "user", content: "legacy" } }]);
  await h.handlers.session_start({ reason: "startup" }, h.ctx);
  assert.equal(h.customs, 0);
  assert.equal(h.entries.length, 1);
  assert.equal(h.statuses[h.statuses.length - 1][1], "profile:Other");
});

test("malformed state falls back visibly without rewriting it", async () => {
  const h = harness(undefined, [{ type: "custom", customType: "startup-profile-state", data: { version: 99 } }]);
  await h.handlers.session_start({ reason: "startup" }, h.ctx);
  assert.equal(h.customs, 0);
  assert.equal(h.entries.length, 1);
  assert.ok(h.notices.some(notice => notice[1] === "warning"));
});

test("shutdown_during_custom_settles_without_snapshot", async () => {
  const h = harness();
  h.setCustom(factory => new Promise(resolve => { h.mount(factory, resolve); }));
  const pending = h.handlers.session_start({ reason: "startup" }, h.ctx);
  await Promise.resolve();
  h.handlers.session_shutdown({}, h.ctx);
  await pending;
  assert.equal(h.entries.length, 0);
  assert.equal(h.doneCallbacks, 1);
});

test("new_session_invalidates_old_enter", async () => {
  const h = harness();
  h.setCustom(factory => new Promise(resolve => { h.mount(factory, resolve); }));
  const first = h.handlers.session_start({ reason: "startup" }, h.ctx);
  await Promise.resolve();
  h.setId("two");
  const second = h.handlers.session_start({ reason: "new" }, h.ctx);
  await first;
  h.components[0]?.handleInput?.("enter");
  assert.equal(h.entries.length, 0);
  h.handlers.session_shutdown({}, h.ctx);
  await second;
  assert.equal(h.entries.length, 0);
  assert.equal(h.doneCallbacks, 2);
});

test("tree before snapshot repairs branch before an immediate clone", async () => {
  const h = harness(undefined, [{ type: "custom", customType: "startup-profile-state", data: snapshot }]);
  await h.handlers.session_start({ reason: "startup" }, h.ctx);
  h.ctx.sessionManager.getBranch = () => [{ type: "model_change", id: "initial-model" }];
  await h.handlers.session_tree({ newLeafId: "initial-model" }, h.ctx);
  assert.equal(h.entries.length, 2);
  assert.deepEqual(h.entries[1].data, snapshot);
  h.ctx.sessionManager.getBranch = () => h.entries;
  await h.handlers.session_tree({ newLeafId: "snapshot" }, h.ctx);
  assert.equal(h.entries.length, 2, "a branch already carrying state must not get duplicates");
});

test("tree does not invent a named profile for legacy or invalid sessions", async () => {
  for (const entries of [
    [{ type: "message", message: { role: "user" } }],
    [{ type: "custom", customType: "startup-profile-state", data: { version: 99 } }],
  ]) {
    const h = harness(undefined, entries);
    await h.handlers.session_start({ reason: "startup" }, h.ctx);
    h.ctx.sessionManager.getBranch = () => [];
    await h.handlers.session_tree({ newLeafId: null }, h.ctx);
    assert.equal(h.entries.length, 1);
  }
});

const PACKAGE_SOURCE = "npm:@papillon6814/pi-gh@0.8.0";

function withEnvRestored(fn: () => Promise<void>) {
  return async () => {
    const saved = { active: process.env.PI_PROFILE_ACTIVE, ctx: process.env.PI_PROFILE_LAUNCH_CONTEXT };
    delete process.env.PI_PROFILE_ACTIVE;
    delete process.env.PI_PROFILE_LAUNCH_CONTEXT;
    try { await fn(); } finally {
      for (const [key, value] of [["PI_PROFILE_ACTIVE", saved.active], ["PI_PROFILE_LAUNCH_CONTEXT", saved.ctx]] as const) {
        if (value === undefined) delete process.env[key]; else process.env[key] = value;
      }
    }
  };
}

function profilesWithPackages(packages: string[] | undefined) {
  const root = mkdtempSync(join(tmpdir(), "startup-profile-pk-"));
  cpSync(fileURLToPath(new URL("../../extensions/startup-profile/profiles/", import.meta.url)), root, { recursive: true });
  if (packages) writeFileSync(join(root, "development", "packages.json"), JSON.stringify({ version: 1, packages }));
  return root;
}

const warnings = (h: { notices: any[] }) => h.notices.filter(n => n[1] === "warning" && String(n[0]).includes("読み込まれていません"));

test("exports active profile id to PI_PROFILE_ACTIVE", withEnvRestored(async () => {
  const h = harness();
  await h.handlers.session_start({ reason: "startup" }, h.ctx);
  assert.equal(process.env.PI_PROFILE_ACTIVE, "developer");
  h.handlers.session_shutdown({}, h.ctx);
  assert.equal(process.env.PI_PROFILE_ACTIVE, undefined);
}));

test("warns when a package profile runs without the launcher", withEnvRestored(async () => {
  const root = profilesWithPackages([PACKAGE_SOURCE]);
  try {
    const h = harness(undefined, [], root);
    await h.handlers.session_start({ reason: "startup" }, h.ctx);
    const found = warnings(h);
    assert.equal(found.length, 1);
    assert.equal(found[0][0], `Profile「Development」のパッケージ（${PACKAGE_SOURCE}）は読み込まれていません。pi を一度終了し、pi-profile launch --profile developer -- --session <会話ファイル> で開き直してください。`);
    const restored = harness(undefined, [{ type: "custom", customType: "startup-profile-state", data: { version: 1, id: "developer", label: "Development", instructions: "X" } }], root);
    await restored.handlers.session_start({ reason: "resume" }, restored.ctx);
    assert.equal(warnings(restored).length, 1);
  } finally { rmSync(root, { recursive: true, force: true }); }
}));

test("does not warn under the launcher or for profiles without packages", withEnvRestored(async () => {
  const bare = profilesWithPackages(undefined);
  const root = profilesWithPackages([PACKAGE_SOURCE]);
  try {
    const h = harness(undefined, [], bare);
    await h.handlers.session_start({ reason: "startup" }, h.ctx);
    assert.equal(warnings(h).length, 0);
    const launch = await writeLaunchContext({
      version: 1,
      profile: { version: 1, id: "developer", label: "Development", instructions: "X" },
      packages: { profileId: "developer", sources: [], resourceRoots: [], extensions: [], skills: [], prompts: [], themes: [] },
      target: { kind: "new", cwd: process.cwd() },
      ownerPid: process.pid,
      nonce: "00000000-0000-0000-0000-000000000000",
    } as any, tmpdir());
    try {
      process.env.PI_PROFILE_LAUNCH_CONTEXT = launch.path;
      const l = harness(undefined, [], root);
      await l.handlers.session_start({ reason: "startup" }, l.ctx);
      assert.equal(warnings(l).length, 0);
    } finally { await launch.dispose(); }
  } finally { rmSync(bare, { recursive: true, force: true }); rmSync(root, { recursive: true, force: true }); }
}));
