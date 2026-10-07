import test from 'node:test';import assert from 'node:assert/strict';import {existsSync,mkdtempSync,mkdirSync,writeFileSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';import {randomUUID} from 'node:crypto';
import startup from '../../extensions/startup-profile/index.ts';import {writeLaunchContext} from '../../src/launch-context.ts';
async function api(){const u=new URL('../../extensions/startup-profile/launch-bridge.ts',import.meta.url);assert.ok(existsSync(u),'launch bridge not implemented');return import(u.href);}
function setup(id='parent'){
 const root=mkdtempSync(join(tmpdir(),'profile-bridge-'));writeFileSync(join(root,'catalog.json'),'[]');
 const entries:any[]=[],handlers:Record<string,Function[]>={},notes:string[]=[],state={id,file:undefined as string|undefined};
 const pi:any={on:(n:string,h:Function)=>{(handlers[n]??=[]).push(h);return()=>{};},appendEntry:(customType:string,data:any)=>entries.push({type:'custom',customType,data}),getCommands:()=>[],events:{emit(){}}};
 const ctx:any={mode:'tui',cwd:root,sessionManager:{getSessionId:()=>state.id,getSessionFile:()=>state.file,getEntries:()=>entries,getBranch:()=>entries},ui:{notify:(s:string)=>notes.push(s),setStatus(){},select:async()=>{throw new Error('double selector');}}};
 const context:any={version:1,profile:{version:1,id:'developer',label:'Development',instructions:'LOCKED'},packages:{profileId:'developer',sources:[],resourceRoots:[],extensions:[],skills:[],prompts:[],themes:[]},target:{kind:'new',cwd:root,forwardedArgs:[]},ownerPid:process.pid,nonce:randomUUID()};
 return{root,entries,handlers,notes,state,pi,ctx,context,emit:async(n:string,event:any)=>{let result;for(const h of handlers[n]??[])result=await h(event,ctx)??result;return result;}};
}
test('fixed bridge skips selection, keeps Profile across new and rejects different-profile resume before shutdown',async()=>{
 await api();const h=setup(),owned=await writeLaunchContext(h.context,h.root),old=process.env.PI_PROFILE_LAUNCH_CONTEXT;process.env.PI_PROFILE_LAUNCH_CONTEXT=owned.path;
 try{
  startup(h.pi,h.root);await h.emit('session_start',{reason:'startup'});
  assert.equal(h.entries.find(e=>e.customType==='startup-profile-state').data.id,'developer');
  await h.emit('session_shutdown',{reason:'new'});h.entries.length=0;h.state.id='new';
  await h.emit('session_start',{reason:'new'});assert.equal(h.entries.find(e=>e.customType==='startup-profile-state').data.instructions,'LOCKED');
  const target=join(h.root,'research.jsonl');writeFileSync(target,[{type:'session',version:3,id:'other',cwd:h.root},{type:'custom',customType:'startup-profile-state',data:{version:1,id:'research',label:'Research',instructions:'R'}}].map(x=>JSON.stringify(x)).join('\n'));
  assert.equal((await h.emit('session_before_switch',{reason:'resume',targetSessionFile:target})).cancel,true);
 }finally{if(old===undefined)delete process.env.PI_PROFILE_LAUNCH_CONTEXT;else process.env.PI_PROFILE_LAUNCH_CONTEXT=old;await owned.dispose();}
});
test('foreign SDK session cannot consume parent launcher binding; root still applies its instructions',async()=>{
 const a=await api(),h=setup(),parent=a.attachLaunchBridge(h.pi,h.context);
 assert.equal(parent.profileForSession({reason:'startup'},h.ctx).id,'developer');
 const child=setup('child');child.context=h.context;child.ctx.mode='print';const c=a.attachLaunchBridge(child.pi,h.context);
 assert.equal(c.profileForSession({reason:'startup'},child.ctx),undefined);
 assert.equal(parent.profileForSession({reason:'reload'},h.ctx).instructions,'LOCKED');
});
