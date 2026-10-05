import test from "node:test";
import assert from "node:assert/strict";
import { applyProfilePrompt } from "../../extensions/startup-profile/prompt.ts";
const snapshot={version:1 as const,id:"developer",label:"開発",instructions:"literal fixture"};
function event(force?:string):any {return {systemPrompt:force ?? "COMMON",systemPromptOptions:{sections:{common:"keep"},contextFiles:[{path:"AGENTS.md",content:"safe"}],skills:[],selectedTools:["read"],forceSystemPrompt:force}};}
test("adds profile section without replacing common instructions or tools",()=>{
 const e=event(); assert.equal(applyProfilePrompt(e,snapshot),undefined);
 assert.deepEqual(e.systemPromptOptions.sections,{common:"keep",startup_profile:"literal fixture"});
 assert.deepEqual(e.systemPromptOptions.selectedTools,["read"]); assert.equal(e.systemPromptOptions.contextFiles[0].content,"safe");
});
test("standard adds no persona section",()=>{const e=event(); applyProfilePrompt(e,{version:1,id:"standard",label:"標準",instructions:""});assert.deepEqual(e.systemPromptOptions.sections,{common:"keep"});});
test("forced upstream prompt retains profile and common text",()=>{
 const e=event("FORCED COMMON"); assert.equal(applyProfilePrompt(e,snapshot)?.systemPrompt,"FORCED COMMON\n\n<startup_profile>\nliteral fixture\n</startup_profile>");
});
test("repeated run starts from baseline and does not accumulate",()=>{
 for(let i=0;i<3;i++){const e=event("COMMON");const r=applyProfilePrompt(e,snapshot)!;assert.equal(r.systemPrompt.split("literal fixture").length,2);}
});
