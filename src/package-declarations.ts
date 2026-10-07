import {readFileSync,realpathSync,lstatSync,existsSync,openSync,writeFileSync,fstatSync,closeSync,renameSync,unlinkSync} from 'node:fs';
import {resolve,isAbsolute,join} from 'node:path';
import {homedir} from 'node:os';
import {randomUUID} from 'node:crypto';
export interface ProfilePackages {version:1;packages:string[]}
export function remoteSource(source:string):boolean{return /^(npm:|git:|https?:\/\/|ssh:\/\/|git@)/.test(source);}
export function normalizeSource(source:string,base:string):string{
 if(typeof source!=='string'||!source.trim()||/[\x00-\x1f\x7f]/.test(source))throw new Error('パッケージsourceが不正です');
 return remoteSource(source)?source:source.startsWith('~/')?join(homedir(),source.slice(2)):resolve(base,source);
}
export function sourceIdentity(source:string):string{
 if(source.startsWith('npm:'))return 'npm:'+source.slice(4).replace(/@[^@/]+$/,'');
 if(/^(git:|https?:\/\/|ssh:\/\/|git@)/.test(source)){
  let s=source.replace(/^git:/,'').replace(/^https?:\/\//,'').replace(/^ssh:\/\/(?:git@)?/,'').replace(/^git@([^:]+):/,'$1/');
  s=s.replace(/[#@][^/]*$/,'').replace(/\.git$/,'').replace(/\/$/,'');
  const slash=s.indexOf('/');return 'git:'+s.slice(0,slash).toLowerCase()+s.slice(slash);
 }
 const absolute=resolve(source);return 'local:'+(existsSync(absolute)?realpathSync(absolute):absolute);
}
function checkFile(file:string):void{
 let stat;try{stat=lstatSync(file);}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return;throw error;}
 if(stat.isSymbolicLink()||!stat.isFile())throw new Error('packages.jsonのsymlinkや非通常ファイルは扱いません');
}
function duplicateKeys(raw:string):void{
 let braces=0,arrays=0,key=true;const seen=new Set<string>();
 for(let i=0;i<raw.length;i++){
  const c=raw[i];
  if(c==='"'){let end=i+1;for(;end<raw.length;end++){if(raw[end]==='\\'){end++;continue;}if(raw[end]==='"')break;}
   if(braces===1&&arrays===0&&key){const value=JSON.parse(raw.slice(i,end+1));if(seen.has(value))throw new Error('packages.jsonの重複キー');seen.add(value);key=false;}i=end;continue;}
  if(c==='{')braces++;else if(c==='}')braces--;else if(c==='[')arrays++;else if(c===']')arrays--;else if(c===','&&braces===1&&arrays===0)key=true;
 }
}
export function loadProfilePackages(profileDirectory:string):ProfilePackages{
 const directory=realpathSync(profileDirectory),file=join(directory,'packages.json');checkFile(file);
 if(!existsSync(file))return {version:1,packages:[]};
 const raw=readFileSync(file,'utf8');const parsed=JSON.parse(raw);duplicateKeys(raw);
 if(!parsed||Array.isArray(parsed)||parsed.version!==1||!Array.isArray(parsed.packages)||Object.keys(parsed).some(k=>!['version','packages'].includes(k)))throw new Error('packages.jsonの形式が不正です');
 const packages=parsed.packages.map((s:unknown)=>{if(typeof s!=='string')throw new Error('sourceは文字列です');return normalizeSource(s,directory);});
 if(new Set(packages.map(sourceIdentity)).size!==packages.length)throw new Error('パッケージ割当が重複しています');
 return {version:1,packages};
}
export async function changeProfilePackages(directory:string,operation:'add'|'remove',source:string,replace:boolean):Promise<ProfilePackages>{
 const base=realpathSync(directory),file=join(base,'packages.json'),lock=join(base,'.packages.lock'),token=randomUUID();
 checkFile(file);
 const fd=openSync(lock,'wx',0o600);const owner=fstatSync(fd);writeFileSync(fd,token);
 let temporary:string|undefined;
 try{
  const prior=existsSync(file)?readFileSync(file):undefined;const config=loadProfilePackages(base),normalized=normalizeSource(source,base),id=sourceIdentity(normalized);
  const index=config.packages.findIndex(s=>sourceIdentity(s)===id);
  if(operation==='add'){if(index>=0&&!replace)throw new Error('既存割当の変更には--replaceが必要です');if(index<0)config.packages.push(normalized);else config.packages[index]=normalized;}
  else {if(index<0)throw new Error('割当がありません');config.packages.splice(index,1);}
  checkFile(file);const now=existsSync(file)?readFileSync(file):undefined;
  if((prior===undefined)!==(now===undefined)||(prior&&now&&!prior.equals(now)))throw new Error('packages.jsonが同時に変更されました');
  const candidate=join(base,'.packages-'+token+'.tmp');const tmp=openSync(candidate,'wx',0o600);temporary=candidate;
  try{writeFileSync(tmp,JSON.stringify(config,null,2)+'\n');}finally{closeSync(tmp);}
  renameSync(temporary,file);temporary=undefined;return config;
 }finally{
  closeSync(fd);
  if(temporary&&existsSync(temporary))unlinkSync(temporary);
  if(existsSync(lock)){const stat=lstatSync(lock);if(!stat.isSymbolicLink()&&stat.ino===owner.ino&&stat.dev===owner.dev&&readFileSync(lock,'utf8')===token)unlinkSync(lock);}
 }
}
