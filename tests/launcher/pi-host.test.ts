import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,mkdtempSync,mkdirSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';import {join} from 'node:path';
async function api(){const u=new URL('../../src/pi-host.ts',import.meta.url);assert.ok(existsSync(u),'Pi host adapter not implemented');return import(u.href);}
test('host is the selected npm Pi; no model/auth runtime is created and old/unsupported layouts are rejected',async()=>{
 const a=await api(),h=await a.loadPiHost('/opt/homebrew/bin/pi');
 assert.equal(h.version,'1.0.4');assert.ok(h.sdk.DefaultPackageManager);assert.ok(h.sdk.SessionManager);
 await assert.rejects(()=>a.loadPiHost('/usr/bin/true'));
 const d=mkdtempSync(join(tmpdir(),'old-pi-'));mkdirSync(join(d,'bin'));
 writeFileSync(join(d,'bin/pi'),'#!/bin/sh\n',{mode:0o755});writeFileSync(join(d,'package.json'),JSON.stringify({name:'@earendil-works/pi-coding-agent',version:'1.0.2',exports:{'.':{import:'./sdk.js'}}}));
 await assert.rejects(()=>a.loadPiHost(join(d,'bin/pi')),/1.0.4/);
});
