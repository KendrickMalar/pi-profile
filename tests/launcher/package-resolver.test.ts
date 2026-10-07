import test from 'node:test';import assert from 'node:assert/strict';
import {existsSync,mkdtempSync,mkdirSync,writeFileSync,readFileSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';
async function api(){const u=new URL('../../src/package-resolver.ts',import.meta.url);assert.ok(existsSync(u),'Profile resolver not implemented');const host=await import('../../src/pi-host.ts');return {...await import(u.href),host:await host.loadPiHost('/opt/homebrew/bin/pi')};}
test('profile store resolves local root provenance and all resources, not shared settings or auth',async()=>{
 const a=await api(),home=mkdtempSync(join(tmpdir(),'profile-resolver-')),pkg=join(home,'pkg'),agent=join(home,'agent');mkdirSync(pkg);mkdirSync(agent);
 writeFileSync(join(agent,'settings.json'),'{"packages":[]}');writeFileSync(join(agent,'auth.json'),'{"marker":"unchanged"}');
 writeFileSync(join(pkg,'package.json'),JSON.stringify({name:'probe',version:'1.0.0',pi:{extensions:['./index.ts']}}));writeFileSync(join(pkg,'index.ts'),'export default function(){}');
 const result=await a.resolveProfilePackages(a.host,'developer',{version:1,packages:[pkg]},home);
 assert.deepEqual(result.resourceRoots,[pkg]);assert.ok(result.extensions[0].endsWith('/index.ts'));
 assert.equal(readFileSync(join(agent,'settings.json'),'utf8'),'{"packages":[]}');assert.equal(readFileSync(join(agent,'auth.json'),'utf8'),'{"marker":"unchanged"}');
 await assert.rejects(()=>a.resolveProfilePackages(a.host,'../escape',{version:1,packages:[]},home));
 await assert.rejects(()=>a.resolveProfilePackages(a.host,'developer',{version:1,packages:[join(home,'absent')]},home));
});
test('standard missing npm source runs the configured installer; failures are not empty success',async()=>{
 const a=await api(),home=mkdtempSync(join(tmpdir(),'profile-fetch-')),log=join(home,'npm.log'),fake=join(home,'npm.mjs');
 writeFileSync(fake,`import fs from 'node:fs';const args=process.argv.slice(2);fs.appendFileSync(${JSON.stringify(log)},JSON.stringify(args)+'\\n');if(args[0]==='root')console.log(${JSON.stringify(join(home,'missing-global'))});else process.exit(41);`);
 const sdk=a.host.sdk,host={...a.host,readGlobalSettings:()=>({packages:[],npmCommand:[process.execPath,fake]}),createPackageManager:({cwd,store,packages,npmCommand}:any)=>new sdk.DefaultPackageManager({cwd,agentDir:store,settingsManager:sdk.SettingsManager.inMemory({packages:packages.packages,npmCommand})})};
 const offline=process.env.PI_OFFLINE;delete process.env.PI_OFFLINE;
 try{await assert.rejects(()=>a.resolveProfilePackages(host,'developer',{version:1,packages:['npm:profile-fetch@1.2.3']},home));assert.ok(readFileSync(log,'utf8').includes('install'));}
 finally{if(offline===undefined)delete process.env.PI_OFFLINE;else process.env.PI_OFFLINE=offline;}
});
test('same identity in common configuration is rejected instead of falsely becoming profile-only',async()=>{
 const a=await api(),home=mkdtempSync(join(tmpdir(),'profile-common-'));
 const host={...a.host,readGlobalSettings:()=>({packages:['npm:probe@1.0.0']})};
 await assert.rejects(()=>a.resolveProfilePackages(host,'developer',{version:1,packages:['npm:probe@2.0.0']},home),/共通|common/);
});

test('successful missing npm and pinned Git sources use standard acquisition in the dedicated store',async()=>{
 const a=await api(),home=mkdtempSync(join(tmpdir(),'profile-acquire-')),bin=join(home,'bin'),log=join(home,'acquire.log');mkdirSync(bin);
 const npm=join(bin,'npm.mjs'),git=join(bin,'git');
 writeFileSync(npm,`import fs from 'node:fs';import path from 'node:path';const args=process.argv.slice(2);fs.appendFileSync(${JSON.stringify(log)},'npm '+JSON.stringify(args)+'\\n');if(args[0]==='root')console.log(${JSON.stringify(join(home,'no-global'))});else{const prefix=args[args.indexOf('--prefix')+1];const d=path.join(prefix,'node_modules','profile-success');fs.mkdirSync(d,{recursive:true});fs.writeFileSync(path.join(d,'package.json'),JSON.stringify({name:'profile-success',version:'1.2.3',pi:{extensions:['index.ts']}}));fs.writeFileSync(path.join(d,'index.ts'),'export default function(){}');}`);
 writeFileSync(git,'#!/opt/homebrew/bin/node\n'+`const fs=require('fs'),path=require('path'),args=process.argv.slice(2);fs.appendFileSync(${JSON.stringify(log)},'git '+JSON.stringify(args)+'\\n');if(args[0]==='clone'){const d=args[args.length-1];fs.mkdirSync(d,{recursive:true});fs.writeFileSync(path.join(d,'package.json'),JSON.stringify({name:'git-probe',version:'1.0.0',pi:{extensions:['index.ts']}}));fs.writeFileSync(path.join(d,'index.ts'),'export default function(){}');}else if(args[0]==='rev-parse')console.log('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');`,{mode:0o755});
 const sdk=a.host.sdk,host={...a.host,readGlobalSettings:()=>({packages:[],npmCommand:[process.execPath,npm]}),createPackageManager:({cwd,store,packages,npmCommand}:any)=>new sdk.DefaultPackageManager({cwd,agentDir:store,settingsManager:sdk.SettingsManager.inMemory({packages:packages.packages,npmCommand})})};
 const oldPath=process.env.PATH,offline=process.env.PI_OFFLINE;process.env.PATH=bin+':'+oldPath;delete process.env.PI_OFFLINE;
 try{
  const n=await a.resolveProfilePackages(host,'developer',{version:1,packages:['npm:profile-success@1.2.3']},home);
  const g=await a.resolveProfilePackages(host,'research',{version:1,packages:['git:github.com/example/probe@aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa']},home);
  assert.equal(n.extensions.length,1);assert.equal(g.extensions.length,1);
  assert.ok(n.resourceRoots[0].includes('/developer/npm/'));assert.ok(g.resourceRoots[0].includes('/research/git/'));
  assert.ok(readFileSync(log,'utf8').includes('clone'));
 }finally{process.env.PATH=oldPath;if(offline===undefined)delete process.env.PI_OFFLINE;else process.env.PI_OFFLINE=offline;}
});

test('dedicated resolution never upgrades discovered project files to trusted explicit roots',async()=>{
 const a=await api(),home=mkdtempSync(join(tmpdir(),'profile-trust-')),cwd=join(home,'cwd');mkdirSync(join(cwd,'.pi/extensions'),{recursive:true});
 writeFileSync(join(cwd,'.pi/extensions/probe.ts'),'export default function(){}');const old=process.cwd();process.chdir(cwd);
 try{const resolved=await a.resolveProfilePackages(a.host,'developer',{version:1,packages:[]},home);assert.deepEqual(resolved.resourceRoots,[]);}
 finally{process.chdir(old);}
});

test('common local relative/symlink aliases reject duplicate dedicated assignment',async()=>{
 const a=await api(),fs=await import('node:fs'),home=mkdtempSync(join(tmpdir(),'profile-alias-')),agent=join(home,'agent'),pkg=join(agent,'pkg');mkdirSync(pkg,{recursive:true});
 const link=join(home,'link');fs.symlinkSync(pkg,link);const env=process.env.PI_CODING_AGENT_DIR;process.env.PI_CODING_AGENT_DIR=agent;
 const host={...a.host,readGlobalSettings:()=>({packages:['./pkg']})};
 try{await assert.rejects(()=>a.resolveProfilePackages(host,'developer',{version:1,packages:[link]},home),/共通/);}
 finally{if(env===undefined)delete process.env.PI_CODING_AGENT_DIR;else process.env.PI_CODING_AGENT_DIR=env;}
});
test('update matches assigned source identity, not only exact version spelling',async()=>{
 const a=await api(),home=mkdtempSync(join(tmpdir(),'profile-update-'));let received;
 const host={...a.host,readGlobalSettings:()=>({packages:[]}),createPackageManager:()=>({update:async(s:any)=>{received=s;}})};
 await a.manageProfilePackages(host,'developer',{version:1,packages:['npm:probe@1.0.0']},home,'update','npm:probe');assert.equal(received,'npm:probe@1.0.0');
});
