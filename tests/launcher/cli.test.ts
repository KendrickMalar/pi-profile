import test from 'node:test';import assert from 'node:assert/strict';import {existsSync,mkdtempSync,mkdirSync,writeFileSync,readFileSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';
async function api(){const u=new URL('../../src/cli.ts',import.meta.url);assert.ok(existsSync(u),'CLI not implemented');return import(u.href);}
test('version passthrough requires no selector/SDK/Profile and management changes only the selected declaration',async()=>{
 const a=await api(),d=mkdtempSync(join(tmpdir(),'profile-cli-')),pi=join(d,'pi'),log=join(d,'args');
 writeFileSync(pi,'#!/bin/sh\nprintf "%s\\n" "$@" > '+JSON.stringify(log)+'\n',{mode:0o755});
 assert.equal(await a.runCli(['launch','--','--version'],{HOME:d,PATH:process.env.PATH,PI_PROFILE_PI_BIN:pi}),0);assert.equal(readFileSync(log,'utf8'),'--version\n');
 const root=join(d,'profiles'),dev=join(root,'development');mkdirSync(dev,{recursive:true});writeFileSync(join(dev,'profile.json'),'{"id":"developer","label":"Development","description":""}');writeFileSync(join(dev,'instructions.md'),'UNCHANGED');
 const env={HOME:d,PATH:process.env.PATH,PI_PROFILE_DIR:root,PI_PROFILE_PI_BIN:'/opt/homebrew/bin/pi'};
 assert.equal(await a.runCli(['packages','add','--profile','developer','npm:probe@1.0.0'],env),0);
 assert.deepEqual(JSON.parse(readFileSync(join(dev,'packages.json'),'utf8')).packages,['npm:probe@1.0.0']);
 assert.equal(await a.runCli(['packages','remove','--profile','developer','npm:probe'],env),0);
 assert.equal(readFileSync(join(dev,'instructions.md'),'utf8'),'UNCHANGED');assert.equal(existsSync(join(d,'.pi/agent/settings.json')),false);
});
