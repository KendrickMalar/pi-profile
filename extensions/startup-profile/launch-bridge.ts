import type {ExtensionAPI,ExtensionContext,SessionStartEvent} from '@earendil-works/pi-coding-agent';
import {homedir} from 'node:os';import type {LaunchContext} from '../../src/launch-context.ts';
import {readSnapshot,type ProfileSnapshot} from './state.ts';import {readSessionProfile} from '../../src/session-target.ts';
import {loadPiHost} from '../../src/pi-host.ts';import {acquireProfilePackages} from '../../src/package-worker-client.ts';
type Binding={pid:number;ids:Set<string>;pending?:{reason:string;file?:string}};
const key=Symbol.for('pi-profile.launch-bindings.v1');
function bindings():Map<string,Binding>{const g=globalThis as any;return g[key]??=(new Map<string,Binding>());}
export function attachLaunchBridge(pi:ExtensionAPI,context:LaunchContext):{profileForSession(event:SessionStartEvent,ctx:ExtensionContext):ProfileSnapshot|undefined;dispose():void}{
 const map=bindings();let managed=false,blocked=false;const stops:Array<()=>void>=[];
 const on=(name:any,handler:any)=>{const stop=(pi.on as any)(name,handler);if(typeof stop==='function')stops.push(stop);};
 on('input',(_event:any,ctx:ExtensionContext)=>{if(managed&&blocked){ctx.ui.notify('起動Profileの整合性を確認し、再起動してください','error');return {action:'handled'};}});
 on('session_before_switch',(event:any,ctx:ExtensionContext)=>{
  if(!managed||event.reason!=='resume'||!event.targetSessionFile)return;
  try{if(readSessionProfile(event.targetSessionFile).profile.id===context.profile.id)return;}
  catch{}
  ctx.ui.notify('別Profileの会話はpi-〇〇 --sessionで新しいプロセスから再開してください','warning');return {cancel:true};
 });
 on('session_shutdown',async(event:any,ctx:ExtensionContext)=>{
  if(!managed)return;const binding=map.get(context.nonce);
  if(event.reason==='quit'){map.delete(context.nonce);return;}
  if(['new','resume','fork'].includes(event.reason)&&binding)binding.pending={reason:event.reason,file:ctx.sessionManager.getSessionFile()};
  if(event.reason==='reload'&&context.packages.sources.length){
   try{const host=await loadPiHost(process.env.PI_PROFILE_PI_BIN??'pi');await acquireProfilePackages(host,context.profile.id,{version:1,packages:context.packages.sources},homedir(),process.env,'resolve',undefined,ctx.mode==='tui');}
   catch{ctx.ui.notify('専用パッケージの再解決に失敗しました。再起動して確認してください','error');}
  }
 });
 return {
  profileForSession(event,ctx){
   if(process.env.PI_SUBAGENT_CHILD==='1')return undefined;
   let binding=map.get(context.nonce);const id=ctx.sessionManager.getSessionId();
   if(!binding){if(process.ppid!==context.ownerPid&&process.pid!==context.ownerPid)return undefined;binding={pid:process.pid,ids:new Set()};map.set(context.nonce,binding);}
   if(binding.pid!==process.pid)return undefined;
   if(!binding.ids.has(id)){
    if(binding.ids.size){if(!binding.pending||binding.pending.reason!==event.reason||binding.pending.file!==event.previousSessionFile)return undefined;binding.pending=undefined;}
    binding.ids.add(id);
   }
   managed=true;const saved=readSnapshot(ctx.sessionManager.getEntries());
   if(saved.invalid||(saved.snapshot&&saved.snapshot.id!==context.profile.id)){blocked=true;throw new Error('保存Profileとランチャーが一致しません');}
   blocked=false;
   if(!ctx.sessionManager.getEntries().some((e:any)=>e.type==='custom'&&e.customType==='startup-profile-launcher-state'))pi.appendEntry('startup-profile-launcher-state',{version:1,id:context.profile.id,fixed:true});
   return saved.snapshot??context.profile;
  },
  dispose(){for(const stop of stops)stop();stops.length=0;},
 };
}
