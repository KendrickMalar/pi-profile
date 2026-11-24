import test from 'node:test';import assert from 'node:assert/strict';import {existsSync,mkdtempSync,mkdirSync,writeFileSync,readFileSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';
type Cli={runCli:(argv:string[],env:NodeJS.ProcessEnv)=>Promise<number>};
async function api():Promise<Cli>{const u=new URL('../../src/cli.ts',import.meta.url);assert.ok(existsSync(u),'CLI not implemented');return await import(u.href) as Cli;}

// Fake kec-orb-handoff: writes its argv one per line to `log`, then exits with `code`.
// Fake pi: records that Pi was started, so a test can prove Pi was not woken up.
function sandbox(code:number){
 const home=mkdtempSync(join(tmpdir(),'scaffold-handoff-')),bin=join(home,'bin'),log=join(home,'handoff-args'),piStub=join(home,'pi-stub'),piMarker=join(home,'pi-started');
 mkdirSync(bin);
 writeFileSync(join(bin,'kec-orb-handoff'),`#!/bin/sh\n: > '${log}'\nfor a in "$@"; do printf '%s\\n' "$a" >> '${log}'; done\nexit ${code}\n`,{mode:0o755});
 writeFileSync(piStub,`#!/bin/sh\n: > '${piMarker}'\nexit 99\n`,{mode:0o755});
 return{home,bin,log,piStub,piMarker};
}
type Sandbox=ReturnType<typeof sandbox>;
function env(s:Sandbox,extra:NodeJS.ProcessEnv={}):NodeJS.ProcessEnv{
 return{HOME:s.home,PATH:`${s.bin}:${process.env.PATH??''}`,PI_PROFILE_PI_BIN:s.piStub,...extra};
}
function handoffArgs(s:Sandbox):string[]|undefined{
 return existsSync(s.log)?readFileSync(s.log,'utf8').split('\n').slice(0,-1):undefined;
}
// The reject must come from the handoff validation, not from the Pi lookup that runs when the handoff branch is absent (the stub Pi is not an npm package, so that lookup fails with 'npm配置のPi…').
const notPiLookup=(e:unknown)=>e instanceof Error&&!/Pi実行ファイル|npm配置のPi|PI_PROFILE_PI_BIN/.test(e.message);
const launchArgv=(packet='/s/p.json')=>['launch','--profile','developer','--','--scaffold-handoff',packet,'--model','m','--thinking','high'];
const tail=['--','--scaffold-handoff','/s/p.json','--model','m','--thinking','high'];

test('scaffold handoff with KEC_ORB_SESSION runs kec-orb-handoff with the forwarded launch and returns its exit code 0',async()=>{
 const a=await api(),s=sandbox(0);
 assert.equal(await a.runCli(launchArgv(),env(s,{KEC_ORB_SESSION:'s1'})),0);
 assert.deepEqual(handoffArgs(s),['--packet','/s/p.json','--','pi-profile','launch','--profile','developer',...tail]);
 assert.equal(existsSync(s.piMarker),false,'Pi must not be started before the handoff');
});

test('scaffold handoff returns the exit code of kec-orb-handoff when it is not 0',async()=>{
 const a=await api(),s=sandbox(7);
 assert.equal(await a.runCli(launchArgv(),env(s,{KEC_ORB_SESSION:'s1'})),7);
 assert.deepEqual(handoffArgs(s),['--packet','/s/p.json','--','pi-profile','launch','--profile','developer',...tail]);
 assert.equal(existsSync(s.piMarker),false);
});

test('scaffold handoff is skipped when KEC_ORB_SESSION is absent',async()=>{
 const a=await api(),s=sandbox(0);
 // Without the handoff branch, runCli goes on to look for Pi; the stub Pi path is valid, so any failure is fine. Only the handoff must not run.
 await a.runCli(launchArgv(),env(s)).catch(()=>undefined);
 assert.equal(handoffArgs(s),undefined);
});

test('scaffold handoff is skipped when KEC_ORB_SESSION is empty',async()=>{
 const a=await api(),s=sandbox(0);
 await a.runCli(launchArgv(),env(s,{KEC_ORB_SESSION:''})).catch(()=>undefined);
 assert.equal(handoffArgs(s),undefined);
});

test('scaffold handoff is skipped when KEC_ORB_HANDOFF_RECEIVER is set (this process is the receiver)',async()=>{
 const a=await api(),s=sandbox(0);
 await a.runCli(launchArgv(),env(s,{KEC_ORB_SESSION:'s1',KEC_ORB_HANDOFF_RECEIVER:'1'})).catch(()=>undefined);
 assert.equal(handoffArgs(s),undefined);
});

test('scaffold handoff runs when KEC_ORB_HANDOFF_RECEIVER is empty, since an empty value counts as absent',async()=>{
 const a=await api(),s=sandbox(0);
 assert.equal(await a.runCli(launchArgv(),env(s,{KEC_ORB_SESSION:'s1',KEC_ORB_HANDOFF_RECEIVER:''})),0);
 assert.deepEqual(handoffArgs(s),['--packet','/s/p.json','--','pi-profile','launch','--profile','developer',...tail]);
});

test('scaffold handoff rejects a packet path with a space before calling kec-orb-handoff',async()=>{
 const a=await api(),s=sandbox(0);
 await assert.rejects(a.runCli(launchArgv('/s/my packet.json'),env(s,{KEC_ORB_SESSION:'s1'})),notPiLookup);
 assert.equal(handoffArgs(s),undefined);
});

test('scaffold handoff puts the fixed env assignments before pi-profile launch, in the order PI_CODING_AGENT_DIR, DETERMINISTIC_SCAFFOLD_DIR, PI_BROWSER_ACCOUNT',async()=>{
 const a=await api(),s=sandbox(0);
 // Pass the variables in a different object order to show the forwarded order is fixed.
 const e=env(s,{PI_BROWSER_ACCOUNT:'muu',KEC_ORB_SESSION:'s1',DETERMINISTIC_SCAFFOLD_DIR:'/h/ds',PI_CODING_AGENT_DIR:'/h/.pi/agent-muu'});
 assert.equal(await a.runCli(launchArgv(),e),0);
 assert.deepEqual(handoffArgs(s),['--packet','/s/p.json','--','env','PI_CODING_AGENT_DIR=/h/.pi/agent-muu','DETERMINISTIC_SCAFFOLD_DIR=/h/ds','PI_BROWSER_ACCOUNT=muu','pi-profile','launch','--profile','developer',...tail]);
});

test('scaffold handoff omits --profile when the launch has none, and omits the env prefix when no listed variable is set',async()=>{
 const a=await api(),s=sandbox(0);
 assert.equal(await a.runCli(['launch','--','--scaffold-handoff','/s/p.json','--model','m','--thinking','high'],env(s,{KEC_ORB_SESSION:'s1'})),0);
 assert.deepEqual(handoffArgs(s),['--packet','/s/p.json','--','pi-profile','launch',...tail]);
});

test('scaffold handoff rejects an env value outside the allowed character set before calling kec-orb-handoff',async()=>{
 const a=await api(),s=sandbox(0);
 await assert.rejects(a.runCli(launchArgv(),env(s,{KEC_ORB_SESSION:'s1',PI_BROWSER_ACCOUNT:'mu u'})),notPiLookup);
 assert.equal(handoffArgs(s),undefined);
});
