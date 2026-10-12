import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { loadProfiles } from '../../extensions/startup-profile/catalog.ts';
import { containedPath } from '../../extensions/startup-profile/folder-profile.ts';
function fixture() { const root=mkdtempSync(join(tmpdir(),'profile-folders-')); writeFileSync(join(root,'catalog.json'),'[]'); return root; }
function folder(root:string, dir:string, meta:Record<string,unknown>, text='INSTRUCTIONS') { mkdirSync(join(root,dir)); writeFileSync(join(root,dir,'profile.json'),JSON.stringify(meta)); if(meta.id!=='standard')writeFileSync(join(root,dir,'instructions.md'),text); }
test('loads_folder_defaults',()=>{const r=fixture();folder(r,'dev',{id:'developer',label:'Dev',description:'code'}); const result=loadProfiles(r); assert.equal(result.profiles[0].id,'developer');assert.equal(result.profiles[0].instructions,'INSTRUCTIONS');});
test('sorts_order_then_id',()=>{const r=fixture();for(const id of ['z','b','a'])folder(r,id,{id,label:id,description:'',order:id==='z'?1:2});assert.deepEqual(loadProfiles(r).profiles.map(p=>p.id),['z','a','b','standard']);});
test('disabled_id_blocks_legacy',()=>{const r=fixture();writeFileSync(join(r,'old.md'),'OLD');writeFileSync(join(r,'catalog.json'),JSON.stringify([{id:'dev',label:'Old',description:'',instructionsFile:'old.md'}]));folder(r,'dev',{id:'dev',label:'Dev',description:'',enabled:false});assert.deepEqual(loadProfiles(r).profiles.map(p=>p.id),['standard']);});
test('duplicate_folder_ids_block_both',()=>{const r=fixture();for(const d of ['one','two'])folder(r,d,{id:'dev',label:'Dev',description:''});const result=loadProfiles(r);assert.deepEqual(result.profiles.map(p=>p.id),['standard']);assert.ok(result.warnings.length>0);});
test('invalid_id_does_not_guess_legacy_id',()=>{const r=fixture();writeFileSync(join(r,'old.md'),'OLD');writeFileSync(join(r,'catalog.json'),JSON.stringify([{id:'dev',label:'Old',description:'',instructionsFile:'old.md'}]));folder(r,'dev',{id:'INVALID',label:'Bad',description:''});assert.equal(loadProfiles(r).profiles[0].instructions,'OLD');});
test('accepts_profile_folder_symlinked_outside_root',()=>{const r=fixture();const outside=fixture();folder(outside,'dev',{id:'dev',label:'Dev',description:''});symlinkSync(join(outside,'dev'),join(r,'dev'));assert.deepEqual(loadProfiles(r).profiles.map(p=>p.id).sort(),['dev','standard']);});
test('standard_has_no_instructions',()=>{const r=fixture();folder(r,'standard',{id:'standard',label:'Other',description:''});writeFileSync(join(r,'standard','instructions.md'),'BAD');const result=loadProfiles(r);assert.equal(result.profiles[0].instructions,'');assert.ok(result.warnings.length>0);});
test('accepts_profile_files_symlinked_outside_root',()=>{const r=fixture();const outside=fixture();folder(outside,'src',{id:'dev',label:'Dev',description:''},'LINKED');mkdirSync(join(r,'dev'));for(const f of ['profile.json','instructions.md'])symlinkSync(join(outside,'src',f),join(r,'dev',f));const dev=loadProfiles(r).profiles.find(p=>p.id==='dev');assert.equal(dev?.instructions,'LINKED');});
test('rejects_dotdot_escape_by_name',()=>{const r=fixture();const outside=fixture();writeFileSync(join(outside,'x.md'),'x');mkdirSync(join(r,'dev'));assert.throws(()=>containedPath(join(r,'dev'),join(r,'dev','..','..',basename(outside),'x.md')),/escapes/);});
