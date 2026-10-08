import { existsSync, statSync } from "node:fs";
import { homedir } from 'node:os';
import { resolveProfileRoot } from './profile-root.ts';
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { loadProfiles, STANDARD_PROFILE } from "./catalog.ts";
import { STATE_ENTRY_TYPE, snapshotProfile, readSnapshot, decideSessionProfile } from "./state.ts";
import type { ProfileSnapshot } from "./state.ts";
import { applyProfilePrompt } from "./prompt.ts";
import type { ProfileDefinition } from './catalog.ts';
import { commonSkillsFromCommands, loadProfileResources, resolveAgentSkillPaths } from './profile-resources.ts';
import { registerProfileAgents } from './subagent-registration.ts';
import {readLaunchContext} from '../../src/launch-context.ts';
import {attachLaunchBridge} from './launch-bridge.ts';

export default function startupProfile(pi: ExtensionAPI, profilesRoot?: string): void {
 const contextFile=process.env.PI_SUBAGENT_CHILD==='1'?undefined:process.env.PI_PROFILE_LAUNCH_CONTEXT;
 const bridge=contextFile?attachLaunchBridge(pi,readLaunchContext(contextFile)):undefined;
 let active:ProfileSnapshot=snapshotProfile(STANDARD_PROFILE);
 let hasStoredProfile=false;
 let generation=0;
 let controller:AbortController|undefined;
 let selectedDefinition:ProfileDefinition|undefined;
 let registration:ReturnType<typeof registerProfileAgents>|undefined;
 let agentCatalog='';
 let pendingSkillSync=false;
 let resourceAgents:ReturnType<typeof loadProfileResources>['agents']=[];
 const release=()=>{registration?.dispose();registration=undefined;pendingSkillSync=false;resourceAgents=[];agentCatalog='';selectedDefinition=undefined;};
 pi.on("session_shutdown",()=>{
  release();
  generation++;controller?.abort();controller=undefined;
  active=snapshotProfile(STANDARD_PROFILE);
  hasStoredProfile=false;
 });
 pi.on("session_start",async(event,ctx)=>{
  release();
  const resolved=profilesRoot!==undefined ? {directory:profilesRoot} : resolveProfileRoot({home:homedir(),override:process.env.PI_PROFILE_DIR});
  let profiles:ProfileDefinition[]=[{...STANDARD_PROFILE}];
  const warnings:string[]=[];
  if(resolved.warning)warnings.push(resolved.warning);
  if(resolved.directory){
   try{
    if(!statSync(resolved.directory).isDirectory())throw new Error('保存先はフォルダではありません');
    const loaded=loadProfiles(resolved.directory);profiles=loaded.profiles;warnings.push(...loaded.warnings);
   }catch(error){warnings.push('個人Profileを読み込めません: '+resolved.directory+'。初期配置を確認してください。 '+String(error));}
  }
  for(const warning of warnings)ctx.ui.notify(warning,'warning');
  controller?.abort();
  const current=++generation; const sessionId=ctx.sessionManager.getSessionId();
  active=snapshotProfile(STANDARD_PROFILE);
  hasStoredProfile=false;
  const entries=ctx.sessionManager.getEntries();
  const restored=readSnapshot(entries);
  const file=ctx.sessionManager.getSessionFile();
  const existingFile=Boolean(file && existsSync(file));
  const hasConversation=entries.some(e=>e.type==="message" && (e.message.role==="user" || e.message.role==="assistant"));
  const fixed=bridge?.profileForSession(event,ctx);
  const decision=bridge ? (restored.snapshot?'restore':'standard') : decideSessionProfile({reason:event.reason,mode:ctx.mode,existingFile,hasConversation,restored});
  if(restored.invalid) ctx.ui.notify("profileの保存状態が不正です。共通指示のみのOtherで開きます。","warning");
  if(fixed){active=fixed;hasStoredProfile=true;if(!restored.snapshot)pi.appendEntry(STATE_ENTRY_TYPE,active);}
  else if(decision==="restore"){ active=restored.snapshot!; hasStoredProfile=true; }
  else if(decision==="select"){
   const options=profiles.map(p=>"["+p.id+"] "+p.label+" — "+p.description);
   controller=new AbortController();
   const selected=await ctx.ui.select("会話のprofileを選択",options,{signal:controller.signal});
   if(current!==generation || sessionId!==ctx.sessionManager.getSessionId() || controller?.signal.aborted) return;
   const index=selected===undefined ? -1 : options.indexOf(selected);
   active=snapshotProfile(index<0 ? STANDARD_PROFILE : profiles[index]);
   pi.appendEntry(STATE_ENTRY_TYPE,active);
   hasStoredProfile=true;
   controller=undefined;
  } else if(!restored.invalid && !existingFile && !hasConversation && ["startup","new"].includes(event.reason)){
   // Noninteractive new conversations must stay standard even if reopened in TUI.
   pi.appendEntry(STATE_ENTRY_TYPE,active);
   hasStoredProfile=true;
  }
  if(!restored.invalid){
   selectedDefinition=profiles.find(p=>p.id===active.id);
   if(!selectedDefinition&&active.id!=='standard')ctx.ui.notify('Profileの追加リソースを読み込めません: '+active.id,'warning');
  }
  ctx.ui.setStatus("startup-profile","profile:"+active.label);
 });
 pi.on('resources_discover',(_event,ctx)=>{
  registration?.dispose();registration=undefined;agentCatalog='';
  if(!selectedDefinition)return {skillPaths:[]};
  const common=commonSkillsFromCommands(pi.getCommands());
  const current=generation, sessionId=ctx.sessionManager.getSessionId();
  const resources=loadProfileResources(selectedDefinition,common.skills,true);
  const next=registerProfileAgents(pi,resources.agents);
  if(current!==generation||sessionId!==ctx.sessionManager.getSessionId()){next.dispose();return {skillPaths:[]};}
  registration=next;resourceAgents=resources.agents;pendingSkillSync=resourceAgents.some(a=>a.definition.skills!==undefined);
  for(const warning of [...common.warnings,...resources.warnings,...next.warnings])ctx.ui.notify(warning,'warning');
  agentCatalog=resources.agents.filter(a=>a.advertise!==false&&next.names.includes(a.name)).map(a=>a.name+' — '+a.definition.description).join('\n');
  return {skillPaths:resources.skillPaths};
 });
 pi.on("session_tree",(_event,ctx)=>{
  if(!hasStoredProfile) return;
  // Clone/fork copies the active branch, not all entries in the session file.
  // Preserve the fixed profile when navigating before its original entry.
  const branch=readSnapshot(ctx.sessionManager.getBranch());
  if(!branch.snapshot && !branch.invalid) pi.appendEntry(STATE_ENTRY_TYPE,active);
 });
 pi.on('before_agent_start',(event,ctx)=>{
  if(pendingSkillSync){
   // All extensions' resources have now merged; use the parent's actual winners.
   pendingSkillSync=false;
   const current=generation,sessionId=ctx.sessionManager.getSessionId();
   const common=commonSkillsFromCommands(pi.getCommands());
   const candidates=new Map(common.skills.map(s=>[s.name,s.filePath]));
   const agents:typeof resourceAgents=[];
   for(const agent of resourceAgents){
    try{agents.push({...agent,definition:{...agent.definition,...(agent.definition.skills!==undefined?{skillPath:resolveAgentSkillPaths(agent.definition.skills,candidates)}:{})}});}
    catch(error){ctx.ui.notify(agent.name+': '+String(error),'warning');}
   }
   registration?.dispose();registration=undefined;
   const next=registerProfileAgents(pi,agents);
   if(current!==generation||sessionId!==ctx.sessionManager.getSessionId()){next.dispose();return;}
   registration=next;
   for(const warning of [...common.warnings,...next.warnings])ctx.ui.notify(warning,'warning');
   agentCatalog=agents.filter(a=>a.advertise!==false&&next.names.includes(a.name)).map(a=>a.name+' — '+a.definition.description).join('\n');
  }
  const result=applyProfilePrompt(event,active);
  if(!agentCatalog)return result;
  const instructions='選択Profileの追加サブエージェント（使用許可を得た作業でのみ利用）:\n'+agentCatalog;
  if(event.systemPromptOptions.forceSystemPrompt!==undefined)return {systemPrompt:(result?.systemPrompt??event.systemPrompt)+'\n\n'+instructions};
  event.systemPromptOptions.sections.profile_agents=instructions;
  return result;
 });
}
