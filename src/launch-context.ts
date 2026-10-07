import {mkdtempSync,writeFileSync,readFileSync,lstatSync,realpathSync,existsSync,unlinkSync,rmdirSync,openSync,closeSync,fstatSync,constants} from 'node:fs';import {join,resolve,isAbsolute} from 'node:path';
import {readSnapshot,type ProfileSnapshot} from '../extensions/startup-profile/state.ts';
import type {ResolvedProfilePackages} from './package-resolver.ts';import type {SessionTarget} from './session-target.ts';
export interface LaunchContext{version:1;profile:ProfileSnapshot;profileRoot?:string;packages:ResolvedProfilePackages;target:SessionTarget;ownerPid:number;nonce:string}
function alive(pid:number):boolean{try{process.kill(pid,0);return true;}catch{return false;}}
export function validateLaunchContext(value:any):LaunchContext{
 if(!value||value.version!==1||!Number.isSafeInteger(value.ownerPid)||value.ownerPid<=0||!alive(value.ownerPid)||typeof value.nonce!=='string'||! /^[a-f0-9-]{36}$/.test(value.nonce))throw new Error('起動情報が不正または期限切れです');
 const s=readSnapshot([{type:'custom',customType:'startup-profile-state',data:value.profile}]);if(s.invalid||!s.snapshot)throw new Error('起動Profileが不正です');
 if(!value.packages||value.packages.profileId!==value.profile.id||!value.target||!['new','resume','fork','ephemeral'].includes(value.target.kind)||!isAbsolute(value.target.cwd))throw new Error('起動対象が不正です');
 for(const key of ['sources','resourceRoots','extensions','skills','prompts','themes'])if(!Array.isArray(value.packages[key])||value.packages[key].some((p:any)=>typeof p!=='string'||/[\x00-\x1f\x7f]/.test(p)))throw new Error('パッケージ起動情報が不正です');
 if(value.profileRoot!==undefined&&(!isAbsolute(value.profileRoot)||/[\x00-\x1f\x7f]/.test(value.profileRoot)))throw new Error('Profile rootが不正です');
 return value as LaunchContext;
}
export function readLaunchContext(file:string):LaunchContext{
 const requested=resolve(file);if(realpathSync(requested)!==requested)throw new Error('起動情報のpathが不正です');
 const fd=openSync(requested,constants.O_RDONLY|constants.O_NOFOLLOW);
 try{const stat=fstatSync(fd);if(!stat.isFile()||(stat.mode&0o077)!==0||stat.nlink!==1||(process.getuid&&stat.uid!==process.getuid()))throw new Error('起動情報の所有・permissionを確認してください');
  return validateLaunchContext(JSON.parse(readFileSync(fd,'utf8')));
 }finally{closeSync(fd);}
}
export async function writeLaunchContext(context:LaunchContext,temporaryRoot:string):Promise<{path:string;dispose():Promise<void>}>{
 validateLaunchContext(context);if(context.ownerPid!==process.pid)throw new Error('起動情報のownerが違います');
 const directory=mkdtempSync(join(realpathSync(temporaryRoot),'pi-profile-launch-')),file=join(directory,'context.json');
 const data={...context,target:{...context.target,forwardedArgs:[]}};writeFileSync(file,JSON.stringify(data),{mode:0o600,flag:'wx'});
 const owned=lstatSync(file);
 return {path:file,dispose:async()=>{
  if(existsSync(file)){const stat=lstatSync(file);let data:any;try{data=JSON.parse(readFileSync(file,'utf8'));}catch{return;}
   if(stat.isSymbolicLink()||stat.ino!==owned.ino||stat.dev!==owned.dev||data.nonce!==context.nonce||data.ownerPid!==context.ownerPid)return;unlinkSync(file);}
  try{rmdirSync(directory);}catch{}
 }};
}
