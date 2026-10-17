import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,mkdtempSync,mkdirSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';import {join} from 'node:path';
async function api(){const u=new URL('../../src/pi-host.ts',import.meta.url);assert.ok(existsSync(u),'Pi host adapter not implemented');return import(u.href);}
test('host is the selected npm Pi; no model/auth runtime is created and old/unsupported layouts are rejected',async()=>{
 const a=await api(),h=await a.loadPiHost('/opt/homebrew/bin/pi');
 assert.ok(a.isSupportedPiVersion(h.version));assert.deepEqual(a.missingSdkApis(h.sdk),[]);assert.ok(h.sdk.DefaultPackageManager);assert.ok(h.sdk.SessionManager);
 await assert.rejects(()=>a.loadPiHost('/usr/bin/true'));
 const d=mkdtempSync(join(tmpdir(),'old-pi-'));mkdirSync(join(d,'bin'));
 writeFileSync(join(d,'bin/pi'),'#!/bin/sh\n',{mode:0o755});writeFileSync(join(d,'package.json'),JSON.stringify({name:'@earendil-works/pi-coding-agent',version:'1.0.2',exports:{'.':{import:'./sdk.js'}}}));
 await assert.rejects(()=>a.loadPiHost(join(d,'bin/pi')),/1.0.4以上/);
});
test('supported Pi range is 1.0.4 up to but excluding 2.0',async()=>{
 const a=await api();
 for(const v of ['1.0.4','1.0.10','1.1.0','1.12.3'])assert.ok(a.isSupportedPiVersion(v),v);
 for(const v of ['1.0.3','1.0.2','0.9.9','2.0.0','1.1.0-beta.1','',undefined])assert.ok(!a.isSupportedPiVersion(v),String(v));
 assert.deepEqual(a.missingSdkApis({}),['DefaultPackageManager','SessionManager','SessionManager.list','SessionManager.listAll','SettingsManager.create','SettingsManager.inMemory','parseSessionEntries']);
});
test('default Pi lookup skips PATH shims and picks the first pi inside a real Pi package; explicit PI_PROFILE_PI_BIN wins',async()=>{
 const a=await api(),{symlinkSync,realpathSync}=await import('node:fs');
 const d=realpathSync(mkdtempSync(join(tmpdir(),'pi-path-')));
 for(const x of ['shim','bin','pkg/bin'])mkdirSync(join(d,x),{recursive:true});
 writeFileSync(join(d,'shim/pi'),'#!/bin/sh\nexec pi-profile launch "$@"\n',{mode:0o755});
 writeFileSync(join(d,'pkg/package.json'),JSON.stringify({name:'@earendil-works/pi-coding-agent',version:'1.0.4'}));
 writeFileSync(join(d,'pkg/bin/pi'),'#!/usr/bin/env node\n',{mode:0o755});symlinkSync(join(d,'pkg/bin/pi'),join(d,'bin/pi'));
 const path=[join(d,'empty'),join(d,'shim'),join(d,'bin')].join(':');
 assert.equal(a.findRealPiOnPath(path),join(d,'pkg/bin/pi'));
 assert.equal(a.piBinFromEnv({PATH:path}),join(d,'pkg/bin/pi'));
 assert.equal(a.piBinFromEnv({PATH:path,PI_PROFILE_PI_BIN:join(d,'shim/pi')}),join(d,'shim/pi'));
 assert.throws(()=>a.findRealPiOnPath(join(d,'shim')),/Pi実行ファイルが見つかりません/);
});
