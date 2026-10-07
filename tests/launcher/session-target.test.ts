import test from 'node:test';import assert from 'node:assert/strict';import {existsSync,mkdtempSync,mkdirSync,writeFileSync,readFileSync,realpathSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';
async function api(){const u=new URL('../../src/session-target.ts',import.meta.url);assert.ok(existsSync(u),'session target not implemented');const h=await import('../../src/pi-host.ts');return {...await import(u.href),host:await h.loadPiHost('/opt/homebrew/bin/pi'),intent:await import('../../src/session-intent.ts')};}
function fixture(){const d=realpathSync(mkdtempSync(join(tmpdir(),'profile-session-'))),cwd=join(d,'cwd'),agent=join(d,'agent'),sessions=join(d,'sessions');for(const x of [cwd,agent,sessions])mkdirSync(x);return{d,cwd,agent,sessions};}
function session(f:any,name:string,id:string,profile:any){const file=join(f.sessions,name+'.jsonl');writeFileSync(file,[{type:'session',version:3,id,timestamp:'2026-10-07T00:00:00.000Z',cwd:f.cwd},...(profile?[{type:'custom',id:'choice',parentId:null,timestamp:'2026-10-07T00:00:00.000Z',customType:'startup-profile-state',data:profile}]:[]),{type:'message',id:'user',parentId:profile?'choice':null,timestamp:'2026-10-07T00:00:01.000Z',message:{role:'user',content:'fixture',timestamp:1}}].map(x=>JSON.stringify(x)).join('\n')+'\n');return file;}
const saved={version:1,id:'developer',label:'Development',instructions:'IMMUTABLE'};
test('saved profile restores without rewriting file; old session is Other and invalid snapshot rejects',async()=>{
 const a=await api(),f=fixture(),file=session(f,'one','one-id',saved),before=readFileSync(file);
 const i=a.intent.parseSessionIntent(['--session',file],{stdin:true,stdout:true}),r=await a.resolveSessionTarget(a.host,i,f.cwd,f.agent,async()=>null);
 assert.equal(r.savedProfile.id,'developer');assert.equal(r.savedProfile.instructions,'IMMUTABLE');assert.ok(readFileSync(file).equals(before));
 const old=session(f,'old','old-id',null);const l=await a.resolveSessionTarget(a.host,a.intent.parseSessionIntent(['--session',old],{stdin:true,stdout:true}),f.cwd,f.agent,async()=>null);assert.equal(l.savedProfile.id,'standard');
 const bad=session(f,'bad','bad-id',{...saved,version:99});await assert.rejects(()=>a.resolveSessionTarget(a.host,a.intent.parseSessionIntent(['--session',bad],{stdin:true,stdout:true}),f.cwd,f.agent,async()=>null));
});
test('session-dir resolution, resume picker and ambiguous IDs preserve startup semantics',async()=>{
 const a=await api(),f=fixture();session(f,'a','abc-one',saved);session(f,'b','abc-two',saved);
 const i=a.intent.parseSessionIntent(['--session-dir',f.sessions,'--session','abc'],{stdin:true,stdout:true});
 await assert.rejects(()=>a.resolveSessionTarget(a.host,i,f.cwd,f.agent,async()=>null),/曖昧|ambiguous/);
 const picker=a.intent.parseSessionIntent(['--session-dir',f.sessions,'--resume'],{stdin:true,stdout:true});
 const r=await a.resolveSessionTarget(a.host,picker,f.cwd,f.agent,async(items:any[])=>items.find(x=>x.id==='abc-one').id);assert.equal(r.sessionId,'abc-one');assert.ok(r.forwardedArgs.includes('--session'));
 const n=await a.resolveSessionTarget(a.host,a.intent.parseSessionIntent(['--session-dir',f.sessions,'--session-id','new-id'],{stdin:true,stdout:true}),f.cwd,f.agent,async()=>null);assert.equal(n.kind,'new');
});

test('session rewrite never strips flag values or literal prompt tail',async()=>{
 const a=await api(),f=fixture(),file=session(f,'argv','argv-id',saved),args=['--session',file,'--model','--continue','--','--session','literal prompt'];
 const i=a.intent.parseSessionIntent(args,{stdin:true,stdout:true});
 const t=await a.resolveSessionTarget(a.host,i,f.cwd,f.agent,async()=>null);
 assert.deepEqual(t.forwardedArgs,['--model','--continue','--session',file,'--','--session','literal prompt']);
});

test('fork pins canonical source despite alias swap and uses the current destination cwd',async()=>{
 const a=await api(),f=fixture(),first=session(f,'first','first-id',saved),second=session(f,'second','second-id',{...saved,id:'research',label:'Research',instructions:'R'});
 const fs=await import('node:fs');const alias=join(f.d,'alias.jsonl');fs.symlinkSync(first,alias);
 const i=a.intent.parseSessionIntent(['--fork',alias,'--session-id','destination','--','--fork','literal'],{stdin:true,stdout:true});
 const target=await a.resolveSessionTarget(a.host,i,f.cwd,f.agent,async()=>null);
 fs.unlinkSync(alias);fs.symlinkSync(second,alias);
 assert.deepEqual(target.forwardedArgs,['--session-id','destination','--fork',first,'--','--fork','literal']);assert.equal(target.cwd,f.cwd);
 const raw=readFileSync(first,'utf8').replace(f.cwd,join(f.d,'missing-checkout'));writeFileSync(first,raw);
 const archived=await a.resolveSessionTarget(a.host,a.intent.parseSessionIntent(['--fork',first],{stdin:true,stdout:true}),f.cwd,f.agent,async()=>null);assert.equal(archived.cwd,f.cwd);
});
test('global discovery finds cross-project IDs and keeps session-id local',async()=>{
 const a=await api(),f=fixture(),other=join(f.d,'other');mkdirSync(other);session(f,'global','global-id',saved);
 const manager={...a.host.sdk.SessionManager,list:async()=>[],listAll:async()=>[{id:'global-id',path:join(f.sessions,'global.jsonl'),cwd:f.cwd,modified:new Date(),firstMessage:'global'}]};
 const host={...a.host,sdk:{...a.host.sdk,SessionManager:manager}};
 const fork=await a.resolveSessionTarget(host,a.intent.parseSessionIntent(['--fork','global-id'],{stdin:true,stdout:true}),other,f.agent,async()=>null);assert.equal(fork.savedProfile.id,'developer');assert.equal(fork.cwd,other);
 const globalSession=await a.resolveSessionTarget(host,a.intent.parseSessionIntent(['--session','global-id'],{stdin:true,stdout:true}),other,f.agent,async()=> 'global-id');assert.equal(globalSession.kind,'fork');
 const fresh=await a.resolveSessionTarget(host,a.intent.parseSessionIntent(['--session-id','global-id'],{stdin:true,stdout:true}),other,f.agent,async()=>null);assert.equal(fresh.kind,'new');
 const resume=await a.resolveSessionTarget(host,a.intent.parseSessionIntent(['--resume'],{stdin:true,stdout:true}),other,f.agent,async(items:any[])=>items[0].id);assert.equal(resume.savedProfile.id,'developer');
});
