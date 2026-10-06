import {existsSync,readdirSync,readFileSync,statSync} from 'node:fs';
import {resolve,basename,dirname,extname} from 'node:path';
import {loadSkills,parseFrontmatter} from '@earendil-works/pi-coding-agent';
import type {SlashCommandInfo} from '@earendil-works/pi-coding-agent';
import type {ProfileDefinition} from './catalog.ts';
import {containedPath} from './folder-profile.ts';
export interface CommonSkill {name:string;filePath:string}
export interface RuntimeAgentDefinitionSubset {
 description:string;systemPrompt:string;tools?:string[];skills?:string[];skillPath?:string[];
 model?:string;thinking?:string|false;systemPromptMode:'append'|'replace';inheritProjectContext:boolean;inheritGlobalContext:boolean;inheritSkills:boolean;
}
export interface ProfileAgent {name:string;definition:RuntimeAgentDefinitionSubset}
export interface ProfileResources {skillPaths:string[];agents:ProfileAgent[];warnings:string[]}
export function commonSkillsFromCommands(commands:readonly SlashCommandInfo[]):{skills:CommonSkill[];warnings:string[]} {
 const skills:CommonSkill[]=[],warnings:string[]=[];
 for(const c of commands)if(c.source==='skill'&&c.name.startsWith('skill:')){
  if(c.sourceInfo?.path&&existsSync(c.sourceInfo.path))skills.push({name:c.name.slice(6),filePath:c.sourceInfo.path});
  else warnings.push('unreadable common skill: '+c.name);
 }
 return {skills,warnings};
}
function list(value:unknown,field:string):string[]|undefined {
 if(value===undefined)return undefined;
 const items=typeof value==='string'?value.split(',').map(s=>s.trim()).filter(Boolean):value;
 if(!Array.isArray(items)||items.some(s=>typeof s!=='string'||!s.trim()))throw new Error('invalid '+field);
 return [...new Set(items as string[])];
}
export function resolveAgentSkillPaths(names:readonly string[],candidates:ReadonlyMap<string,string>):string[] {
 return names.map(s=>{const p=candidates.get(s);if(!p)throw new Error('missing skill: '+s);const name=basename(p)==='SKILL.md'?basename(dirname(p)):basename(p,extname(p));if(name!==s)throw new Error('child skill name must match folder/file: '+s);return p;});
}
export function loadProfileResources(profile:ProfileDefinition,commonSkills:readonly CommonSkill[],deferAgentSkills=false):ProfileResources {
 const out:ProfileResources={skillPaths:[],agents:[],warnings:[]};
 if(!profile.directory)return out;
 const root=profile.directory, candidates=new Map(commonSkills.map(s=>[s.name,s.filePath]));
 const visit=(path:string,seen:Set<string>)=>{
  try {
   const target=containedPath(root,path);
   if(seen.has(target))return; seen.add(target);
   if(!statSync(target).isDirectory())return;
   if(existsSync(resolve(target,'SKILL.md'))){
    const file=containedPath(root,resolve(target,'SKILL.md'));
    if(!statSync(file).isFile())throw new Error('SKILL.md must be a regular file');
    // Explicit file loading cannot fall through to SDK directory recursion.
    const result=loadSkills({cwd:root,agentDir:root,includeDefaults:false,skillPaths:[file]});
    out.warnings.push(...result.diagnostics.map(d=>d.message));
    for(const s of result.skills){if(candidates.has(s.name)){out.warnings.push('duplicate skill: '+s.name);continue;}candidates.set(s.name,s.filePath);out.skillPaths.push(s.filePath);}
    return;
   }
   for(const e of readdirSync(target,{withFileTypes:true}))if(e.isDirectory()||e.isSymbolicLink())visit(resolve(target,e.name),seen);
  }catch(error){out.warnings.push('profile skills: '+String(error));}
 };
 if(existsSync(resolve(root,'skills')))visit(resolve(root,'skills'),new Set());
 const names=new Set<string>(),duplicates=new Set<string>();
 try {
  const dir=resolve(root,'agents');if(!existsSync(dir))return out;
  containedPath(root,dir);
  for(const entry of readdirSync(dir).sort()){
   if(!entry.endsWith('.md'))continue;
   try {
    const {frontmatter:m,body}=parseFrontmatter<Record<string,unknown>>(readFileSync(containedPath(root,resolve(dir,entry)),'utf8'));
    if(Object.keys(m).some(k=>!['name','description','tools','skills','model','thinking','systemPromptMode','inheritProjectContext','inheritGlobalContext','inheritSkills'].includes(k)))throw new Error('unknown agent field');
    if(typeof m.name!=='string'||! /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(m.name)||typeof m.description!=='string'||!m.description.trim()||!body.trim())throw new Error('invalid agent name/description/body');
    const name='profile.'+profile.id+'.'+m.name;
    if(names.has(name)){duplicates.add(name);throw new Error('duplicate agent name: '+name);}names.add(name);
    const tools=list(m.tools,'tools'),skills=list(m.skills,'skills');
    if(tools?.some(t=>t.includes('/')||t.includes('\\')||/\.(?:ts|js)$/i.test(t)))throw new Error('extension paths are not allowed in tools');
    const d:RuntimeAgentDefinitionSubset={description:m.description.trim(),systemPrompt:body.trim(),systemPromptMode:'append',inheritProjectContext:true,inheritGlobalContext:true,inheritSkills:false};
    if(tools!==undefined)d.tools=tools;
    if(skills!==undefined){d.skills=skills;if(!deferAgentSkills)d.skillPath=resolveAgentSkillPaths(skills,candidates);}
    for(const key of ['inheritProjectContext','inheritGlobalContext','inheritSkills'] as const)if(m[key]!==undefined){if(typeof m[key]!=='boolean')throw new Error('invalid '+key);d[key]=m[key];}
    if(m.systemPromptMode!==undefined){if(m.systemPromptMode!=='append'&&m.systemPromptMode!=='replace')throw new Error('invalid systemPromptMode');d.systemPromptMode=m.systemPromptMode;}
    if(m.model!==undefined){if(typeof m.model!=='string'||!m.model.trim())throw new Error('invalid model');d.model=m.model;}
    if(m.thinking!==undefined){if(m.thinking!==false&&typeof m.thinking!=='string')throw new Error('invalid thinking');d.thinking=m.thinking;}
    out.agents.push({name,definition:d});
   }catch(error){out.warnings.push('profile agent '+entry+': '+String(error));}
  }
 }catch(error){out.warnings.push('profile agents: '+String(error));}
 out.agents=out.agents.filter(a=>!duplicates.has(a.name));
 return out;
}
