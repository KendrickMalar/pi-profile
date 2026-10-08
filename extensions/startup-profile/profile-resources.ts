import {existsSync,readdirSync,readFileSync,statSync} from 'node:fs';
import {homedir} from 'node:os';
import {resolve,basename,dirname,extname,isAbsolute,join} from 'node:path';
import {loadSkills,parseFrontmatter} from '@earendil-works/pi-coding-agent';
import type {SlashCommandInfo} from '@earendil-works/pi-coding-agent';
import type {ProfileDefinition} from './catalog.ts';
import {containedPath} from './folder-profile.ts';
export interface CommonSkill {name:string;filePath:string}
export interface RuntimeAgentDefinitionSubset {
 description:string;systemPrompt:string;tools?:string[];skills?:string[];skillPath?:string[];
 model?:string;thinking?:string|false;systemPromptMode:'append'|'replace';inheritProjectContext:boolean;inheritGlobalContext:boolean;inheritSkills:boolean;
 extensions?:string[];defaultContext?:'fresh'|'fork';defaultAsync?:boolean;acceptanceRole?:'read-only'|'writer';allowNestedSubagents?:boolean;allowedAgents?:string[];
}
export interface ProfileAgent {name:string;advertise?:boolean;definition:RuntimeAgentDefinitionSubset}
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
const AGENT_FIELDS=['name','description','tools','skills','model','thinking','systemPromptMode','inheritProjectContext','inheritGlobalContext','inheritSkills','advertise','extensions','defaultContext','async','acceptanceRole','allowNestedSubagents','allowedAgents'];
function bool(value:unknown,field:string):boolean|undefined {
 if(value===undefined)return undefined;
 if(typeof value!=='boolean')throw new Error('invalid '+field);
 return value;
}
function oneOf<T extends string>(value:unknown,field:string,allowed:readonly T[]):T|undefined {
 if(value===undefined)return undefined;
 if(typeof value!=='string'||!(allowed as readonly string[]).includes(value))throw new Error('invalid '+field);
 return value as T;
}
// Extensions run code, so only absolute or home-relative paths are accepted (like PI_PROFILE_DIR).
function extensionPaths(value:unknown):string[]|undefined {
 const paths=list(value,'extensions');
 return paths?.map(p=>{
  if(/[\x00-\x1f\x7f]/.test(p)||(!isAbsolute(p)&&!p.startsWith('~/')))throw new Error('invalid extensions: use an absolute or ~/ path');
  return p.startsWith('~/')?join(homedir(),p.slice(2)):p;
 });
}
function declaredAgentNames(dir:string,root:string):Set<string> {
 const names=new Set<string>();
 for(const entry of readdirSync(dir).sort()){
  if(!entry.endsWith('.md'))continue;
  try{const {frontmatter:m}=parseFrontmatter<Record<string,unknown>>(readFileSync(containedPath(root,resolve(dir,entry)),'utf8'));if(typeof m.name==='string')names.add(m.name);}catch{}
 }
 return names;
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
  // allowedAgents may name siblings by their short name; map them to the registered profile names.
  const siblings=declaredAgentNames(dir,root);
  for(const entry of readdirSync(dir).sort()){
   if(!entry.endsWith('.md'))continue;
   try {
    const {frontmatter:m,body}=parseFrontmatter<Record<string,unknown>>(readFileSync(containedPath(root,resolve(dir,entry)),'utf8'));
    const unknown=Object.keys(m).filter(k=>!AGENT_FIELDS.includes(k));
    if(unknown.length)throw new Error('unknown agent field: '+unknown.join(', '));
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
    const extensions=extensionPaths(m.extensions);if(extensions!==undefined)d.extensions=extensions;
    const defaultContext=oneOf(m.defaultContext,'defaultContext',['fresh','fork'] as const);if(defaultContext!==undefined)d.defaultContext=defaultContext;
    const defaultAsync=bool(m.async,'async');if(defaultAsync!==undefined)d.defaultAsync=defaultAsync;
    const acceptanceRole=oneOf(m.acceptanceRole,'acceptanceRole',['read-only','writer'] as const);if(acceptanceRole!==undefined)d.acceptanceRole=acceptanceRole;
    const allowNestedSubagents=bool(m.allowNestedSubagents,'allowNestedSubagents');if(allowNestedSubagents!==undefined)d.allowNestedSubagents=allowNestedSubagents;
    const allowed=m.allowedAgents===undefined?undefined:Array.isArray(m.allowedAgents)&&m.allowedAgents.length===0?[]:list(m.allowedAgents,'allowedAgents');
    if(allowed!==undefined)d.allowedAgents=[...new Set(allowed.map(a=>siblings.has(a)?'profile.'+profile.id+'.'+a:a))];
    const advertise=bool(m.advertise,'advertise');
    out.agents.push({name,...(advertise!==undefined?{advertise}:{}),definition:d});
   }catch(error){out.warnings.push('profile agent '+entry+': '+String(error));}
  }
 }catch(error){out.warnings.push('profile agents: '+String(error));}
 out.agents=out.agents.filter(a=>!duplicates.has(a.name));
 return out;
}
