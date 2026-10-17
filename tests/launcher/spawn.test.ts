import test from 'node:test';import assert from 'node:assert/strict';import {existsSync} from 'node:fs';
async function api(){const u=new URL('../../src/spawn.ts',import.meta.url);assert.ok(existsSync(u),'spawn not implemented');return import(u.href);}
const home='/h';
const idleShell=JSON.stringify({result:{process_info:{shell_pid:10,foreground_process_group_id:10,foreground_processes:[{name:'fish',pid:10}]}}});
const busyShell=JSON.stringify({result:{process_info:{shell_pid:10,foreground_process_group_id:20,foreground_processes:[{name:'node',pid:20}]}}});
const pane=(agent?:string,status?:string)=>JSON.stringify({result:{pane:{pane_id:'w1:p2',...(agent?{agent}:{}),...(status?{agent_status:status}:{})}}});
type Reply={code?:number;stdout?:string;stderr?:string};
// panes: successive `pane get` replies (the last one repeats).
function stub(o:{info?:string;panes?:string[];codes?:Record<string,number>}={}){
 const calls:string[][]=[],panes=o.panes??[pane('pi','idle')];let n=0;
 return{calls,herdr:async(a:string[]):Promise<{code:number;stdout:string;stderr:string}>=>{calls.push(a);const key=a[0]+' '+a[1];
  const r:Reply=key==='pane process-info'?{stdout:o.info??idleShell}:key==='pane get'?{stdout:panes[Math.min(n++,panes.length-1)]}:{};
  return{code:o.codes?.[key]??r.code??0,stdout:r.stdout??'',stderr:r.stderr??''};}};
}
function clock(){let now=0;const sleeps:number[]=[];return{sleeps,now:()=>now,sleep:async(ms:number)=>{sleeps.push(ms);now+=ms;}};}
async function capture(fn:()=>Promise<number>){let out='',err='';const o=process.stdout.write,e=process.stderr.write;(process.stdout as any).write=(s:any)=>{out+=s;return true};(process.stderr as any).write=(s:any)=>{err+=s;return true};
 try{const code=await fn();return{code,out,err};}finally{process.stdout.write=o;process.stderr.write=e;}}
const runs=(calls:string[][])=>calls.filter(c=>c[0]==='pane'&&c[1]==='run');
test('spawns with parent profile and muu account after checking the pane is an idle shell',async()=>{
 const a=await api(),s=stub(),c=clock(),r=await capture(()=>a.runSpawn({pane:'w1:p2',args:[],env:{PI_PROFILE_ACTIVE:'developer',PI_CODING_AGENT_DIR:home+'/.pi/agent-muu'},home,herdr:s.herdr,...c}));
 assert.equal(r.code,0);assert.deepEqual(s.calls[0],['pane','process-info','--pane','w1:p2']);
 assert.deepEqual(s.calls[1],['pane','run','w1:p2','env PI_PROFILE_ID=developer pi-account muu']);
 assert.deepEqual(s.calls[2],['pane','get','w1:p2']);assert.ok(!s.calls.some(x=>x[0]==='agent'&&x[1]==='wait'));
 assert.deepEqual(JSON.parse(r.out.trim()),{pane:'w1:p2',profile:'developer',account:'muu'});
});
test('falls back to standard and kuno with a notice',async()=>{
 const a=await api(),s=stub(),r=await capture(()=>a.runSpawn({pane:'w1:p2',args:[],env:{},home,herdr:s.herdr,...clock()}));
 assert.equal(runs(s.calls)[0][3],'env PI_PROFILE_ID=standard pi-account kuno');assert.match(r.err,/PI_PROFILE_ACTIVE がないため標準 Profile で起動しました/);
});
test('refuses unknown agent dir and unsafe values',async()=>{
 const a=await api(),s=stub();
 const r=await capture(()=>a.runSpawn({pane:'w1:p2',args:[],env:{PI_CODING_AGENT_DIR:'/tmp/x'},home,herdr:s.herdr,...clock()}));
 assert.equal(r.code,1);assert.equal(s.calls.length,0);
 await assert.rejects(()=>a.runSpawn({pane:'w1:p2',args:['--model','a b'],env:{},home,herdr:s.herdr,...clock()}));assert.equal(s.calls.length,0);
 assert.equal(a.accountFromAgentDir(home+'/.pi/agent-rbx/',home),'rbx');assert.equal(a.accountFromAgentDir(undefined,home),'kuno');
});
test('refuses a pane that is not at an idle shell and runs nothing',async()=>{
 const a=await api();
 for(const info of [busyShell,JSON.stringify({result:{process_info:{foreground_processes:[{name:'vim'}]}}}),JSON.stringify({result:{process_info:{foreground_processes:[{name:'zsh'},{name:'node'}]}}}),'not json']){
  const s=stub({info}),r=await capture(()=>a.runSpawn({pane:'w1:p2',args:[],env:{},home,herdr:s.herdr,...clock()}));
  assert.equal(r.code,1,info);assert.equal(runs(s.calls).length,0,info);assert.match(r.err,/w1:p2/);
 }
 const s=stub({codes:{'pane process-info':1}}),r=await capture(()=>a.runSpawn({pane:'w1:p2',args:[],env:{},home,herdr:s.herdr,...clock()}));
 assert.equal(r.code,1);assert.equal(runs(s.calls).length,0);assert.match(r.err,/w1:p2/);
});
test('accepts a shell found only by foreground process name when shell_pid is absent',async()=>{
 const a=await api(),s=stub({info:JSON.stringify({result:{process_info:{foreground_processes:[{name:'-fish'}]}}})});
 const r=await capture(()=>a.runSpawn({pane:'w1:p2',args:[],env:{},home,herdr:s.herdr,...clock()}));assert.equal(r.code,0);assert.equal(runs(s.calls).length,1);
});
test('polls pane get every second until the pane hosts pi in a ready state',async()=>{
 const a=await api(),c=clock(),s=stub({panes:[pane(),pane('pi','working'),pane('pi','unknown'),pane('pi','blocked')]});
 const r=await capture(()=>a.runSpawn({pane:'w1:p2',name:'kem',args:[],env:{},home,herdr:s.herdr,...c}));
 assert.equal(r.code,0);assert.equal(s.calls.filter(x=>x[1]==='get').length,4);assert.deepEqual(c.sleeps,[1000,1000,1000]);
 assert.deepEqual(s.calls.at(-1),['agent','rename','w1:p2','kem']);
});
test('times out after 120000 ms, names the pane and does not relaunch or rename',async()=>{
 const a=await api(),c=clock(),s=stub({panes:[pane('claude','idle')]});
 const r=await capture(()=>a.runSpawn({pane:'w1:p2',name:'kem',args:[],env:{},home,herdr:s.herdr,...c}));
 assert.equal(r.code,1);assert.equal(runs(s.calls).length,1);assert.match(r.err,/w1:p2/);assert.ok(c.now()>=120000&&c.now()<=121000,String(c.now()));
 assert.ok(!s.calls.some(x=>x[1]==='rename'));
});
test('renames when name given',async()=>{
 const a=await api(),s=stub();await capture(()=>a.runSpawn({pane:'w1:p2',name:'kem',args:[],env:{},home,herdr:s.herdr,...clock()}));
 assert.deepEqual(s.calls.at(-1),['agent','rename','w1:p2','kem']);
});
test('realHerdr reports the spawn error message when stderr is empty',async()=>{
 const a=await api(),{execFileError}=a;
 assert.equal(execFileError(Object.assign(new Error('spawn herdr ENOENT'),{code:'ENOENT'}),''),'spawn herdr ENOENT');
 assert.equal(execFileError(new Error('x'),'boom\n'),'boom\n');
});
