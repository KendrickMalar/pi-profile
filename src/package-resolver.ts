import {existsSync,lstatSync,mkdirSync,realpathSync} from 'node:fs';
import {join,isAbsolute,resolve} from 'node:path';
import type {PiHost} from './pi-host.ts';
import {remoteSource,sourceIdentity,type ProfilePackages} from './package-declarations.ts';
export interface ResolvedProfilePackages {profileId:string;sources:string[];resourceRoots:string[];extensions:string[];skills:string[];prompts:string[];themes:string[]}
function storeFor(home:string,id:string):string{
 if(!isAbsolute(home)||! /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id))throw new Error('Profile保存先が不正です');
 let current=realpathSync(home);
 for(const part of ['.pi','profile-packages',id]){current=join(current,part);if(existsSync(current)&&lstatSync(current).isSymbolicLink())throw new Error('専用storeのsymlinkは扱いません');mkdirSync(current,{recursive:true,mode:0o700});}
 return current;
}
function preparation(host:PiHost,id:string,packages:ProfilePackages,home:string){
 const cwd=process.cwd(),agentDir=process.env.PI_CODING_AGENT_DIR??join(home,'.pi','agent'),global=host.readGlobalSettings(cwd,agentDir);
 const common=(global.packages??[]).map(p=>{const source=typeof p==='string'?p:p.source;return sourceIdentity(remoteSource(source)?source:source.startsWith('~/')?join(home,source.slice(2)):resolve(agentDir,source));});
 for(const source of packages.packages){if(common.includes(sourceIdentity(source)))throw new Error('共通パッケージとの割当が重複しています');if(!remoteSource(source)&&!existsSync(source))throw new Error('ローカルパッケージがありません');}
 const store=storeFor(home,id);
 return host.createPackageManager({cwd,store,packages,npmCommand:global.npmCommand});
}
export async function resolveProfilePackages(host:PiHost,profileId:string,packages:ProfilePackages,home:string):Promise<ResolvedProfilePackages>{
 const manager=preparation(host,profileId,packages,home),resolved=await manager.resolveExtensionSources(packages.packages);
 const result:ResolvedProfilePackages={profileId,sources:[...packages.packages],resourceRoots:[],extensions:[],skills:[],prompts:[],themes:[]};
 for(const kind of ['extensions','skills','prompts','themes'] as const){
  const entries=resolved[kind].filter(r=>r.enabled);result[kind]=entries.map(r=>r.path);
  for(const r of entries){const root=r.metadata.packageRoot??(kind==='extensions'?r.path:undefined);if(root&&!result.resourceRoots.includes(root))result.resourceRoots.push(root);}
 }
 return result;
}
export async function manageProfilePackages(host:PiHost,profileId:string,packages:ProfilePackages,home:string,operation:'install'|'update',source?:string):Promise<void>{
 const manager=preparation(host,profileId,packages,home);
 if(operation==='install'){for(const s of packages.packages)await manager.install(s);}
 else {const selected=source?packages.packages.find(s=>sourceIdentity(s)===sourceIdentity(source)):undefined;if(source&&!selected)throw new Error('更新対象は割当済みsourceを指定してください');await manager.update(selected);}
}
