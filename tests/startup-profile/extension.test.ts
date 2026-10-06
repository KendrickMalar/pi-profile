import test from "node:test";
import assert from "node:assert/strict";
import extension from "../../extensions/startup-profile/index.ts";
import { fileURLToPath } from 'node:url';
function harness(choice:string|null|undefined="[developer] Development — コード・設計・検証を中心に支援",restore:unknown[]=[]) {
 const handlers:Record<string,Function>={}; const entries:any[]=[...restore]; const notices:any[]=[]; const statuses:any[]=[]; let selects=0;let id="one";
 const pi:any={on:(n:string,h:Function)=>{handlers[n]=h;return()=>{};},appendEntry:(customType:string,data:unknown)=>entries.push({type:"custom",customType,data})};
 for(const name of ["setModel","setThinkingLevel","setActiveTools","registerCommand","registerShortcut","registerFlag"]) pi[name]=()=>assert.fail("out-of-scope API "+name);
 let selectImpl=async (_title:string,opts:string[],_options:any)=>{selects++;assert.equal(entries.filter(e=>e.customType==="startup-profile-state").length,0);assert.equal(opts.length,5);return choice ?? undefined;};
 const ctx:any={mode:"tui",hasUI:true,sessionManager:{getEntries:()=>entries,getSessionFile:()=>undefined,getSessionId:()=>id},ui:{select:(...args:any[])=>selectImpl(...args as [string,string[],any]),notify:(...args:any[])=>notices.push(args),setStatus:(...args:any[])=>statuses.push(args)}};
 extension(pi,fileURLToPath(new URL('../../extensions/startup-profile/profiles/',import.meta.url)));return {handlers,entries,notices,statuses,ctx,get selects(){return selects;},setSelect:(f:any)=>{selectImpl=f;},setId:(next:string)=>{id=next;}};
}
const snapshot={version:1,id:"developer",label:"開発",instructions:"RESTORED"};
test("selects and saves snapshot before first agent run",async()=>{
 const h=harness();await h.handlers.session_start({reason:"startup"},h.ctx);
 assert.equal(h.selects,1);assert.equal(h.entries[0].data.id,"developer");assert.equal(h.statuses.at(-1)[1],"profile:Development");
 const e:any={systemPrompt:"BASE",systemPromptOptions:{sections:{}}};h.handlers.before_agent_start(e,h.ctx);assert.match(e.systemPromptOptions.sections.startup_profile,/コード・設計/);
});
for (const [id,label,description,heading] of [
 ["specification","Specification","要件・制約・受け入れ条件を整理し、仕様にまとめる","仕様"],
 ["research","Research","情報を調べ、出典付きの資料・表にまとめる","調査"],
 ["chore","Chore（雑務）","整理・定型作業などの雑務を支援","雑務"],
]) test("selects and applies "+id,async()=>{
 const h=harness(`[${id}] ${label} — ${description}`);await h.handlers.session_start({reason:"startup"},h.ctx);
 assert.equal(h.entries[0].data.id,id);assert.equal(h.entries[0].data.label,label);
 const e:any={systemPrompt:"BASE",systemPromptOptions:{sections:{common:"KEEP"}}};h.handlers.before_agent_start(e,h.ctx);
 assert.ok(e.systemPromptOptions.sections.startup_profile.startsWith(`# ${heading}profile`));assert.equal(e.systemPromptOptions.sections.common,"KEEP");
});
test("restores removed secretary profile from saved text",async()=>{
 const saved={version:1,id:"secretary",label:"秘書",instructions:"OLD_SECRETARY_TEXT"};
 const h=harness(null,[{type:"custom",customType:"startup-profile-state",data:saved}]);await h.handlers.session_start({reason:"resume"},h.ctx);
 assert.equal(h.selects,0);assert.equal(h.statuses.at(-1)[1],"profile:秘書");
 const e:any={systemPrompt:"BASE",systemPromptOptions:{sections:{}}};h.handlers.before_agent_start(e,h.ctx);assert.equal(e.systemPromptOptions.sections.startup_profile,saved.instructions);
});
test("cancel chooses standard without changing models tools or credentials",async()=>{
 const h=harness(null);await h.handlers.session_start({reason:"startup"},h.ctx);assert.equal(h.entries[0].data.id,"standard");
});
for(const reason of ["startup","reload","resume","fork"])test("restores immutable snapshot without UI "+reason,async()=>{
 const h=harness(undefined,[{type:"custom",customType:"startup-profile-state",data:snapshot}]);await h.handlers.session_start({reason},h.ctx);
 assert.equal(h.selects,0);assert.equal(h.entries.length,1);const e:any={systemPrompt:"BASE",systemPromptOptions:{sections:{}}};h.handlers.before_agent_start(e,h.ctx);assert.equal(e.systemPromptOptions.sections.startup_profile,"RESTORED");
});
test("new conversation drops previous selection",async()=>{
 const h=harness();await h.handlers.session_start({reason:"startup"},h.ctx);
 h.entries.length=0;h.setId("two");h.setSelect(async()=>undefined);await h.handlers.session_start({reason:"new"},h.ctx);
 assert.equal(h.entries[0].data.id,"standard");assert.equal(h.statuses.at(-1)[1],"profile:Other");
});
for(const mode of ["print","json","rpc"])test("noninteractive never asks "+mode,async()=>{
 const h=harness();h.ctx.mode=mode;h.ctx.hasUI=false;await h.handlers.session_start({reason:"startup"},h.ctx);assert.equal(h.selects,0);
});
test("legacy conversation has no selector or new profile entry",async()=>{
 const h=harness(undefined,[{type:"message",message:{role:"user",content:"legacy"}}]);await h.handlers.session_start({reason:"startup"},h.ctx);assert.equal(h.selects,0);assert.equal(h.entries.length,1);assert.equal(h.statuses.at(-1)[1],"profile:Other");
});
test("malformed state falls back visibly without rewriting it",async()=>{
 const h=harness(undefined,[{type:"custom",customType:"startup-profile-state",data:{version:99}}]);await h.handlers.session_start({reason:"startup"},h.ctx);assert.equal(h.selects,0);assert.equal(h.entries.length,1);assert.ok(h.notices.some(n=>n[1]==="warning"));
});
test("shutdown cancels pending selection and prevents stale writes",async()=>{
 const h=harness();let resolve!:(v:string)=>void;let signal!:AbortSignal;
 h.setSelect((_title:any,_opts:any,o:any)=>{signal=o.signal;return new Promise(r=>{resolve=r;});});
 const pending=h.handlers.session_start({reason:"startup"},h.ctx);await Promise.resolve();h.handlers.session_shutdown({},h.ctx);assert.equal(signal.aborted,true);resolve("[developer] Development — コード・設計・検証を中心に支援");await pending;assert.equal(h.entries.length,0);
});
test("tree before snapshot repairs branch before an immediate clone",async()=>{
 const h=harness(undefined,[{type:"custom",customType:"startup-profile-state",data:snapshot}]);
 await h.handlers.session_start({reason:"startup"},h.ctx);
 h.ctx.sessionManager.getBranch=()=>[{type:"model_change",id:"initial-model"}];
 await h.handlers.session_tree({newLeafId:"initial-model"},h.ctx);
 assert.equal(h.entries.length,2);assert.deepEqual(h.entries[1].data,snapshot);
 h.ctx.sessionManager.getBranch=()=>h.entries;
 await h.handlers.session_tree({newLeafId:"snapshot"},h.ctx);
 assert.equal(h.entries.length,2,"a branch already carrying state must not get duplicates");
});
test("tree does not invent a named profile for legacy or invalid sessions",async()=>{
 for(const entries of [[{type:"message",message:{role:"user"}}],[{type:"custom",customType:"startup-profile-state",data:{version:99}}]]){
  const h=harness(undefined,entries);await h.handlers.session_start({reason:"startup"},h.ctx);
  h.ctx.sessionManager.getBranch=()=>[];
  await h.handlers.session_tree({newLeafId:null},h.ctx);
  assert.equal(h.entries.length,1);
 }
});
