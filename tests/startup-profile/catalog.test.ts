import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, symlinkSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadProfiles } from "../../extensions/startup-profile/catalog.ts";
function fixture(t: any, items: unknown = [{id:"standard",label:"標準",description:"標準"},{id:"developer",label:"開発",description:"コード",instructionsFile:"developer.md"}]) {
 const dir=mkdtempSync(join(tmpdir(),"profiles-")); t.after(()=>rmSync(dir,{recursive:true,force:true}));
 writeFileSync(join(dir,"catalog.json"),JSON.stringify(items)); writeFileSync(join(dir,"developer.md"),"開発 fixture"); return dir;
}
test("loads initial profiles and their Markdown instructions",()=>{
 const r=loadProfiles(new URL("../../extensions/startup-profile/profiles/",import.meta.url).pathname);
 assert.deepEqual(r.profiles.map(p=>[p.id,p.label]),[["research","Research"],["specification","Specification"],["developer","Development"],["chore","Chore（雑務）"],["standard","Other"]]);
 assert.equal(r.profiles.at(-1)!.instructions,""); assert.ok(r.profiles.slice(0,-1).every(p=>p.instructions.length>0)); assert.deepEqual(r.warnings,[]);
});
test("catalog order places standard last without duplicating it",t=>{
 const r=loadProfiles(fixture(t,[{id:"developer",label:"Development",description:"",instructionsFile:"developer.md"},{id:"standard",label:"Other",description:""}]));
 assert.deepEqual(r.profiles.map(p=>p.id),["developer","standard"]);assert.equal(r.profiles[1].label,"Other");assert.equal(r.profiles[1].instructions,"");
});
test("missing or invalid standard is appended as a safe fallback",t=>{
 for (const suffix of [[],[{id:"standard",label:"Other",description:"",instructionsFile:"developer.md"}]]) {
  const r=loadProfiles(fixture(t,[{id:"developer",label:"Development",description:"",instructionsFile:"developer.md"},...suffix]));
  assert.deepEqual(r.profiles.map(p=>p.id),["developer","standard"]);assert.equal(r.profiles[1].label,"Other");assert.equal(r.profiles[1].instructions,"");
 }
});
test("loads literal Markdown instead of a catalog filename",t=>{
 const r=loadProfiles(fixture(t)); assert.equal(r.profiles[1].instructions,"開発 fixture");
});
test("duplicate IDs fall back to standard with warning",t=>{
 const r=loadProfiles(fixture(t,[{id:"standard",label:"標準",description:""},{id:"standard",label:"別",description:""}]));
 assert.deepEqual(r.profiles.map(p=>p.id),["standard"]); assert.ok(r.warnings.length);
});
for(const file of ["../secret.md","/tmp/secret.md","developer.txt"]) test("rejects external or invalid path "+file,t=>{
 const r=loadProfiles(fixture(t,[{id:"developer",label:"開発",description:"",instructionsFile:file}]));
 assert.deepEqual(r.profiles.map(p=>p.id),["standard"]); assert.ok(r.warnings.length);
});
test("rejects symlink escaping the catalog directory",t=>{
 const dir=fixture(t); const outside=mkdtempSync(join(tmpdir(),"outside-profile-")); t.after(()=>rmSync(outside,{recursive:true,force:true}));
 writeFileSync(join(outside,"secret.md"),"secret"); symlinkSync(join(outside,"secret.md"),join(dir,"escape.md"));
 writeFileSync(join(dir,"catalog.json"),JSON.stringify([{id:"developer",label:"開発",description:"",instructionsFile:"escape.md"}]));
 const r=loadProfiles(dir); assert.equal(r.profiles.length,1); assert.ok(r.warnings.length);
});
test("invalid catalog returns standard with warning",t=>{
 const dir=fixture(t); writeFileSync(join(dir,"catalog.json"),"{");
 const r=loadProfiles(dir); assert.deepEqual(r.profiles.map(p=>p.id),["standard"]); assert.ok(r.warnings.length);
});
test("missing catalog returns standard with warning",()=>{ const r=loadProfiles("/no-such-profile-directory"); assert.equal(r.profiles[0].instructions,""); assert.ok(r.warnings.length); });
test("missing Markdown skips the broken profile",t=>{
 const r=loadProfiles(fixture(t,[{id:"developer",label:"開発",description:"",instructionsFile:"missing.md"}]));
 assert.deepEqual(r.profiles.map(p=>p.id),["standard"]); assert.ok(r.warnings.length);
});
test("standard cannot acquire persona instructions",t=>{
 const r=loadProfiles(fixture(t,[{id:"standard",label:"標準",description:"",instructionsFile:"developer.md"}]));
 assert.equal(r.profiles[0].instructions,""); assert.ok(r.warnings.length);
});
