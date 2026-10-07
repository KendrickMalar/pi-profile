import test from 'node:test';import assert from 'node:assert/strict';import {existsSync,mkdtempSync,writeFileSync,readFileSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';
async function api(){const u=new URL('../../src/launch.ts',import.meta.url);assert.ok(existsSync(u),'launcher spawn not implemented');return import(u.href);}
test('normal Pi spawn preserves argv/env and exit status without adding offline, and releases owned context',async()=>{
 const a=await api(),d=mkdtempSync(join(tmpdir(),'profile-spawn-')),file=join(d,'pi'),log=join(d,'args.json');
 writeFileSync(file,'#!/opt/homebrew/bin/node\n'+`const fs=require('fs');fs.writeFileSync(${JSON.stringify(log)},JSON.stringify({args:process.argv.slice(2),agent:process.env.PI_CODING_AGENT_DIR,offline:process.env.PI_OFFLINE,context:process.env.PI_PROFILE_LAUNCH_CONTEXT}));process.exit(7);`,{mode:0o755});
 const empty={profileId:'developer',sources:[],resourceRoots:[],extensions:[],skills:[],prompts:[],themes:[]};
 const result=await a.launchPi({host:{executable:file},target:{kind:'new',cwd:d,forwardedArgs:['--model','value with space','--','日本語 prompt']},profile:{version:1,id:'developer',label:'Development',instructions:'FIXED'},packages:empty,env:{HOME:d,PATH:process.env.PATH,PI_CODING_AGENT_DIR:join(d,'account')}});
 assert.equal(result,7);const payload=JSON.parse(readFileSync(log,'utf8'));assert.equal(payload.agent,join(d,'account'));assert.equal('offline'in payload,false);
 assert.ok(payload.args.includes('value with space'));assert.deepEqual(payload.args.slice(-2),['--','日本語 prompt']);assert.equal(existsSync(payload.context),false);
});

test('compiled launcher uses the shipped extension source, not a nonexistent dist .ts path',async()=>{
 const u=new URL('../../dist/src/launch.js',import.meta.url);assert.ok(existsSync(u),'build the CLI first');const a=await import(u.href);
 assert.ok(existsSync(a.startupExtension),a.startupExtension);
});
