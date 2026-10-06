import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import type { ProfileDefinition } from './catalog.ts';
export interface FolderProfile extends ProfileDefinition { directory: string; order: number; enabled: boolean }
export function containedPath(root:string, path:string):string {
 const base=realpathSync(root), target=realpathSync(path), rel=relative(base,target);
 if(rel==='..'||rel.startsWith('..'+sep)||isAbsolute(rel))throw new Error('path escapes profile root');
 return target;
}
export function scanFolderProfiles(root:string):{profiles:FolderProfile[];blockedIds:string[];warnings:string[]} {
 const profiles:FolderProfile[]=[], warnings:string[]=[], blocked=new Set<string>(), seen=new Set<string>(), duplicates=new Set<string>();
 try {
  for(const entry of readdirSync(root,{withFileTypes:true}).sort((a,b)=>a.name<b.name?-1:a.name>b.name?1:0)) {
   if(!entry.isDirectory()&&!entry.isSymbolicLink())continue;
   let id:string|undefined;
   try {
    const directory=containedPath(root,resolve(root,entry.name));
    if(!statSync(directory).isDirectory()||!existsSync(resolve(directory,'profile.json')))continue;
    const m=JSON.parse(readFileSync(containedPath(directory,resolve(directory,'profile.json')),'utf8'));
    if(!m||typeof m!=='object'||Array.isArray(m)||typeof m.id!=='string'||! /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(m.id))throw new Error('invalid profile ID');
    id=m.id;
    if(seen.has(id!)){duplicates.add(id!);throw new Error('duplicate profile ID: '+id);} seen.add(id!);blocked.add(id!);
    if(Object.keys(m).some(k=>!['id','label','description','order','enabled'].includes(k)))throw new Error('unknown profile field');
    if(typeof m.label!=='string'||!m.label.trim()||typeof m.description!=='string'||/[\x00-\x1f\x7f]/.test(m.label+m.description))throw new Error('invalid display text');
    if(m.order!==undefined&&!Number.isSafeInteger(m.order))throw new Error('invalid order');
    if(m.enabled!==undefined&&typeof m.enabled!=='boolean')throw new Error('invalid enabled');
    if(m.enabled===false)continue;
    const file=resolve(directory,'instructions.md');
    if(id==='standard'&&existsSync(file))throw new Error('standard must have no instructions');
    const instructions=id==='standard'?'':readFileSync(containedPath(directory,file),'utf8');
    profiles.push({id:id!,label:m.label,description:m.description,instructions,directory,order:m.order??100,enabled:true});
   }catch(error){warnings.push('profile folder '+entry.name+': '+String(error));}
  }
 }catch(error){warnings.push('profile folders: '+String(error));}
 return {profiles:profiles.filter(p=>!duplicates.has(p.id)).sort((a,b)=>a.order-b.order||(a.id<b.id?-1:a.id>b.id?1:0)),blockedIds:[...blocked],warnings};
}
