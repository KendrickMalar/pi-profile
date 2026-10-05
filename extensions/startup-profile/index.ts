import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { loadProfiles, STANDARD_PROFILE } from "./catalog.ts";
import { STATE_ENTRY_TYPE, snapshotProfile, readSnapshot, decideSessionProfile } from "./state.ts";
import type { ProfileSnapshot } from "./state.ts";
import { applyProfilePrompt } from "./prompt.ts";

export default function startupProfile(pi: ExtensionAPI): void {
 let active:ProfileSnapshot=snapshotProfile(STANDARD_PROFILE);
 let hasStoredProfile=false;
 let generation=0;
 let controller:AbortController|undefined;
 pi.on("session_shutdown",()=>{
  generation++;controller?.abort();controller=undefined;
  active=snapshotProfile(STANDARD_PROFILE);
  hasStoredProfile=false;
 });
 pi.on("session_start",async(event,ctx)=>{
  controller?.abort();
  const current=++generation; const sessionId=ctx.sessionManager.getSessionId();
  active=snapshotProfile(STANDARD_PROFILE);
  hasStoredProfile=false;
  const entries=ctx.sessionManager.getEntries();
  const restored=readSnapshot(entries);
  const file=ctx.sessionManager.getSessionFile();
  const existingFile=Boolean(file && existsSync(file));
  const hasConversation=entries.some(e=>e.type==="message" && (e.message.role==="user" || e.message.role==="assistant"));
  const decision=decideSessionProfile({reason:event.reason,mode:ctx.mode,existingFile,hasConversation,restored});
  if(restored.invalid) ctx.ui.notify("profileの保存状態が不正です。共通指示のみのOtherで開きます。","warning");
  if(decision==="restore"){ active=restored.snapshot!; hasStoredProfile=true; }
  else if(decision==="select"){
   const {profiles,warnings}=loadProfiles(fileURLToPath(new URL("./profiles/",import.meta.url)));
   for(const warning of warnings) ctx.ui.notify(warning,"warning");
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
  ctx.ui.setStatus("startup-profile","profile:"+active.label);
 });
 pi.on("session_tree",(_event,ctx)=>{
  if(!hasStoredProfile) return;
  // Clone/fork copies the active branch, not all entries in the session file.
  // Preserve the fixed profile when navigating before its original entry.
  const branch=readSnapshot(ctx.sessionManager.getBranch());
  if(!branch.snapshot && !branch.invalid) pi.appendEntry(STATE_ENTRY_TYPE,active);
 });
 pi.on("before_agent_start",(event)=>applyProfilePrompt(event,active));
}
