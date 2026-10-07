import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,readFileSync,existsSync,symlinkSync,realpathSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
async function api(){const u=new URL('../../src/package-declarations.ts',import.meta.url);assert.ok(existsSync(u),'package declarations not implemented');return import(u.href);}
const dir=()=>realpathSync(mkdtempSync(join(tmpdir(),'profile-declarations-')));
test('missing declaration is empty; duplicate/unknown/non-string/control data are rejected',async()=>{
 const a=await api(),d=dir();assert.deepEqual(a.loadProfilePackages(d),{version:1,packages:[]});
 for(const raw of ['{"version":1,"version":1,"packages":[]}','{"version":1,"packages":[],"extra":0}','{"version":1,"packages":[1]}','{"version":1,"packages":[""]}','{"version":1,"packages":["npm:x\\u0000"]}']){
  writeFileSync(join(d,'packages.json'),raw);assert.throws(()=>a.loadProfilePackages(d));
 }
});
test('local paths normalize relative to profile; source strings containing quotes or braces stay data',async()=>{
 const a=await api(),d=dir();writeFileSync(join(d,'packages.json'),JSON.stringify({version:1,packages:['./local package','npm:x@1.0.0','./{quoted \"file\"}']}));
 assert.deepEqual(a.loadProfilePackages(d).packages,[join(d,'local package'),'npm:x@1.0.0',join(d,'{quoted "file"}')]);
});
test('add replace remove preserves other sources and refuses foreign lock or symlink declaration',async()=>{
 const a=await api(),d=dir();await a.changeProfilePackages(d,'add','npm:one@1.0.0',false);await a.changeProfilePackages(d,'add','npm:two',false);
 await assert.rejects(()=>a.changeProfilePackages(d,'add','npm:one@2.0.0',false));
 await a.changeProfilePackages(d,'add','npm:one@2.0.0',true);
 assert.deepEqual(a.loadProfilePackages(d).packages,['npm:one@2.0.0','npm:two']);
 await a.changeProfilePackages(d,'remove','npm:one',false);assert.deepEqual(a.loadProfilePackages(d).packages,['npm:two']);
 writeFileSync(join(d,'.packages.lock'),'foreign');await assert.rejects(()=>a.changeProfilePackages(d,'add','npm:three',false));
 assert.equal(readFileSync(join(d,'.packages.lock'),'utf8'),'foreign');
 const e=dir(),outside=join(d,'outside.json');writeFileSync(outside,'{"version":1,"packages":[]}');symlinkSync(outside,join(e,'packages.json'));
 assert.throws(()=>a.loadProfilePackages(e));assert.equal(readFileSync(outside,'utf8'),'{"version":1,"packages":[]}');
});
test('source identity ignores version/ref and normalizes git transports without conflating npm with git',async()=>{
 const a=await api();
 assert.equal(a.sourceIdentity('npm:@a/pkg@1.0.0'),a.sourceIdentity('npm:@a/pkg@2.0.0'));
 assert.equal(a.sourceIdentity('git:github.com/Owner/repo@main'),a.sourceIdentity('git:git@github.com:Owner/repo.git@abc'));
 assert.notEqual(a.sourceIdentity('npm:repo'),a.sourceIdentity('git:github.com/Owner/repo'));
});

test('dangling declaration symlink is rejected, never replaced with a new declaration',async()=>{
 const a=await api(),d=dir();symlinkSync(join(d,'absent-target'),join(d,'packages.json'));
 assert.throws(()=>a.loadProfilePackages(d));
 await assert.rejects(()=>a.changeProfilePackages(d,'add','npm:x',false));
});
