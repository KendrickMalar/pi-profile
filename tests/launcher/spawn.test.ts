import test from 'node:test';import assert from 'node:assert/strict';import {existsSync} from 'node:fs';
async function api(){const u=new URL('../../src/spawn.ts',import.meta.url);assert.ok(existsSync(u),'spawn not implemented');return import(u.href);}
const home='/h';
function stub(codes:Record<string,number>={}){const calls:string[][]=[];return{calls,herdr:async(a:string[])=>{calls.push(a);return{code:codes[a[1]]??0,stdout:'',stderr:''};}};}
async function capture(fn:()=>Promise<number>){let out='',err='';const o=process.stdout.write,e=process.stderr.write;(process.stdout as any).write=(s:any)=>{out+=s;return true};(process.stderr as any).write=(s:any)=>{err+=s;return true};
 try{const code=await fn();return{code,out,err};}finally{process.stdout.write=o;process.stderr.write=e;}}
test('spawns with parent profile and muu account',async()=>{
 const a=await api(),s=stub(),r=await capture(()=>a.runSpawn({pane:'w1:p2',args:[],env:{PI_PROFILE_ACTIVE:'developer',PI_CODING_AGENT_DIR:home+'/.pi/agent-muu'},home,herdr:s.herdr}));
 assert.equal(r.code,0);assert.deepEqual(s.calls[0],['pane','run','w1:p2','env PI_PROFILE_ID=developer pi-account muu']);
 assert.deepEqual(s.calls[1],['agent','wait','w1:p2','--until','idle','--timeout','120000']);
 assert.deepEqual(JSON.parse(r.out.trim()),{pane:'w1:p2',profile:'developer',account:'muu'});
});
test('falls back to standard and kuno with a notice',async()=>{
 const a=await api(),s=stub(),r=await capture(()=>a.runSpawn({pane:'w1:p2',args:[],env:{},home,herdr:s.herdr}));
 assert.equal(s.calls[0][3],'env PI_PROFILE_ID=standard pi-account kuno');assert.match(r.err,/PI_PROFILE_ACTIVE がないため標準 Profile で起動しました/);
});
test('refuses unknown agent dir and unsafe values',async()=>{
 const a=await api(),s=stub();
 const r=await capture(()=>a.runSpawn({pane:'w1:p2',args:[],env:{PI_CODING_AGENT_DIR:'/tmp/x'},home,herdr:s.herdr}));
 assert.equal(r.code,1);assert.equal(s.calls.length,0);
 await assert.rejects(()=>a.runSpawn({pane:'w1:p2',args:['--model','a b'],env:{},home,herdr:s.herdr}));assert.equal(s.calls.length,0);
 assert.equal(a.accountFromAgentDir(home+'/.pi/agent-rbx/',home),'rbx');assert.equal(a.accountFromAgentDir(undefined,home),'kuno');
});
test('reports pane on wait failure without relaunch',async()=>{
 const a=await api(),s=stub({wait:1}),r=await capture(()=>a.runSpawn({pane:'w1:p2',args:[],env:{},home,herdr:s.herdr}));
 assert.equal(r.code,1);assert.equal(s.calls.filter(c=>c[1]==='run').length,1);assert.match(r.err,/w1:p2/);
});
test('renames when name given',async()=>{
 const a=await api(),s=stub();await capture(()=>a.runSpawn({pane:'w1:p2',name:'kem',args:[],env:{},home,herdr:s.herdr}));
 assert.deepEqual(s.calls[2],['agent','rename','w1:p2','kem']);
});
