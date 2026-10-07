import test from 'node:test';
import assert from 'node:assert/strict';
import { NativeFixture } from './fixtures.ts';
import { writeFileSync } from 'node:fs';
import { once } from 'node:events';

// Task 1's characterization gate: these are installed-Pi/native-CLI probes,
// not acceptance tests for a product launcher that has not been implemented.

test('native_profile_package_root: native CLI discovers package tools, skills and prompts', async () => {
  const f = await new NativeFixture().start();
  try {
    f.makePackage(); f.makeBridge(false);
    const child = await f.startRpc();
    const commands = await f.command(child, 'get_commands');
    assert.equal(commands.success, true);
    const names = commands.data.commands.map((c: any) => c.name);
    assert.ok(names.includes('native-prompt'), JSON.stringify(names));
    assert.ok(names.includes('skill:native-skill'), JSON.stringify(names));
    await f.command(child, 'prompt', { message: 'NATIVE_INITIAL_PROMPT' });
    await f.waitUntil(() => f.calls.length === 1);
    await f.waitUntil(() => f.records.some(r => r.type === 'agent_end'));
    assert.ok(f.calls[0].tools.some((t: any) => t.function?.name === 'native_package_tool'));
    assert.ok(JSON.stringify(f.calls[0].messages).includes('NATIVE_SKILL_DESCRIPTION'));
    assert.ok(f.events().includes('package-factory'));
  } finally { await f.dispose(); }
});

test('reload_resolution_before_load: dedicated resolver runs before native package factory reload', async () => {
  const f = await new NativeFixture().start();
  try {
    f.makePackage(); f.makeBridge(true);
    const child = await f.startRpc();
    const before = f.events().length;
    const result = await f.command(child, 'prompt', { message: '/native-reload' });
    assert.equal(result.success, true);
    await f.waitUntil(() => f.events().slice(before).includes('bridge-start'));
    const events = f.events().slice(before);
    assert.ok(events.includes('profile-resolved'), JSON.stringify(events));
    assert.ok(events.indexOf('profile-resolved') < events.indexOf('package-factory'), JSON.stringify(events));
    assert.equal(f.calls.length, 0, 'reload command must not invoke the model');
  } finally { await f.dispose(); }
});

test('broken_initial_package: native CLI rejects factory failure before any model request', async () => {
  const f = await new NativeFixture().start();
  try {
    f.makePackage(true); f.makeBridge(true);
    writeFileSync(f.packageEntry, "export default function(){throw new Error('NATIVE_INITIAL_BROKEN');}");
    const child = await f.startRpc(false);
    const [code] = await once(child, 'exit');
    assert.equal(code, 1);
    assert.ok(f.stderr.includes('NATIVE_INITIAL_BROKEN'), f.stderr);
    assert.equal(f.calls.length, 0);
  } finally { await f.dispose(); }
});

test('profile_manifest_provenance: standard resolver retains all four package resource kinds', async () => {
  const f = await new NativeFixture().start();
  try {
    f.makePackage();
    const sdkPath = '/opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent/dist/index.js';
    const {DefaultPackageManager, SettingsManager} = await import(sdkPath);
    const manager = new DefaultPackageManager({cwd:f.cwd,agentDir:f.store,settingsManager:SettingsManager.inMemory({packages:[f.packageRoot]})});
    const resolved = await manager.resolve();
    for (const [kind, tail] of [['extensions','/index.ts'],['skills','/native-skill/SKILL.md'],['prompts','/native-prompt.md'],['themes','/native-theme.json']] as const) {
      assert.ok(resolved[kind].some((r:any)=>r.path.endsWith(tail) && r.metadata.packageRoot===f.packageRoot), kind);
    }
  } finally { await f.dispose(); }
});

test('child_does_not_consume_parent_context: SDK child cannot claim its parent launch context', async () => {
  const f = await new NativeFixture().start();
  try {
    f.makePackage(); f.makeScopeBridge(true);
    const child = await f.startRpc();
    const result = await f.command(child, 'prompt', { message: '/native-child' });
    assert.equal(result.success, true);
    await f.waitUntil(() => f.events().includes('child-bind-finished'));
    assert.equal(f.events().filter(e => e === 'scope-managed-start').length, 1);
    assert.ok(f.events().includes('scope-child-ignored'));
    assert.equal(f.calls.length, 0);
  } finally { await f.dispose(); }
});

test('native_reload_failure_matches_standard_pi: factory failure may allow a later RPC model turn', async () => {
  const f = await new NativeFixture().start();
  try {
    // A valid extension may have only lifecycle handlers, no named tool or command.
    // Capability-name disappearance therefore cannot detect every load failure.
    f.makePackage(true); f.makeBridge(true);
    const child = await f.startRpc();
    const before = f.events().length;
    const result = await f.command(child, 'prompt', { message: '/native-break' });
    await f.waitUntil(() => f.events().slice(before).includes('bridge-start'));
    assert.ok(f.events().slice(before).includes('profile-resolved'));
    assert.ok(f.events().slice(before).includes('broken-factory-entered'), 'The corrupt factory must actually be loaded, not a cached old factory');
    const state = await f.command(child, 'get_state');
    assert.equal(state.success, true);
    await f.command(child, 'prompt', { message: 'AFTER_PACKAGE_FAILURE' });
    await f.waitUntil(() => f.records.some(r => r.type === 'agent_end'));
    assert.equal(result.success, true, 'characterize the standard RPC reload response');
    assert.equal(f.calls.length, 1, 'standard Pi may continue after reload failure; initial-startup rejection is tested separately');
  } finally { await f.dispose(); }
});
