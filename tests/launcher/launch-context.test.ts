import test from 'node:test';import assert from 'node:assert/strict';import {existsSync,mkdtempSync,readFileSync,writeFileSync,statSync,symlinkSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';import {randomUUID} from 'node:crypto';
async function api(){const u=new URL('../../src/launch-context.ts',import.meta.url);assert.ok(existsSync(u),'launch context not implemented');return import(u.href);}
function context(d:string){return{version:1,profile:{version:1,id:'developer',label:'Development',instructions:'FIXED'},packages:{profileId:'developer',sources:[],resourceRoots:[],extensions:[],skills:[],prompts:[],themes:[]},target:{kind:'new',cwd:d,forwardedArgs:['--api-key','FAKE_NEVER_PERSIST']},ownerPid:process.pid,nonce:randomUUID()};}
test('private context excludes command secrets, round-trips, and removes only its owned file',async()=>{
 const a=await api(),d=mkdtempSync(join(tmpdir(),'launch-context-')),c=context(d),owned=await a.writeLaunchContext(c,d);
 assert.equal(statSync(owned.path).mode&0o777,0o600);assert.equal(readFileSync(owned.path,'utf8').includes('FAKE_NEVER_PERSIST'),false);
 assert.equal(a.readLaunchContext(owned.path).profile.instructions,'FIXED');await owned.dispose();assert.equal(existsSync(owned.path),false);
});
test('corruption/symlink/stale owner refuse; cleanup does not destroy replacement content',async()=>{
 const a=await api(),d=mkdtempSync(join(tmpdir(),'launch-context-')),owned=await a.writeLaunchContext(context(d),d);
 writeFileSync(owned.path,'foreign');assert.throws(()=>a.readLaunchContext(owned.path));await owned.dispose();assert.equal(readFileSync(owned.path,'utf8'),'foreign');
 const link=join(d,'link');symlinkSync(owned.path,link);assert.throws(()=>a.readLaunchContext(link));
 const c=context(d);c.ownerPid=999999999;await assert.rejects(()=>a.writeLaunchContext(c,d));
});
