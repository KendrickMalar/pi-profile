import {readFileSync,existsSync,realpathSync} from 'node:fs';
import {join,resolve,isAbsolute,dirname} from 'node:path';
import {homedir} from 'node:os';import {createHash} from 'node:crypto';
import type {PiHost} from './pi-host.ts';import {withoutSessionSelectors,optionTerminatorIndex,type SessionIntent} from './session-intent.ts';
import {readSnapshot,snapshotProfile,type ProfileSnapshot} from '../extensions/startup-profile/state.ts';
import {STANDARD_PROFILE} from '../extensions/startup-profile/catalog.ts';
export interface SessionTarget{kind:'new'|'resume'|'fork'|'ephemeral';cwd:string;sessionPath?:string;sessionId?:string;sessionDigest?:string;savedProfile?:ProfileSnapshot;forwardedArgs:string[]}
export type SessionChooser=(items:ReadonlyArray<{id:string;path:string;title:string;profileId:string}>)=>Promise<string|null>;
function absolute(path:string,cwd:string):string{return path.startsWith('~/')?join(homedir(),path.slice(2)):resolve(cwd,path);}
export function readSessionProfile(file:string,host?:PiHost):{profile:ProfileSnapshot;id:string;cwd:string;digest:string}{
 const raw=readFileSync(file,'utf8');const entries:any[]=host?host.sdk.parseSessionEntries(raw):raw.split('\n').filter(Boolean).map(s=>JSON.parse(s));
 const header=entries.find(e=>e.type==='session');if(!header||typeof header.id!=='string'||typeof header.cwd!=='string')throw new Error('会話headerが不正です');
 const saved=readSnapshot(entries);if(saved.invalid)throw new Error('保存Profileが不正または矛盾しています');
 return {profile:saved.snapshot??snapshotProfile(STANDARD_PROFILE),id:header.id,cwd:header.cwd,digest:createHash('sha256').update(raw).digest('hex')};
}
export async function resolveSessionTarget(host:PiHost,intent:SessionIntent,cwd:string,agentDir:string,choose:SessionChooser):Promise<SessionTarget>{
 if(intent.kind==='new'||intent.kind==='ephemeral'||intent.kind==='passthrough')return {kind:intent.kind==='ephemeral'?'ephemeral':'new',cwd,sessionId:intent.reference,forwardedArgs:[...intent.originalArgs]};
 let projectDir:string|undefined;const project=join(cwd,'.pi/settings.json');
 if(existsSync(project)){const settings=JSON.parse(readFileSync(project,'utf8'));if(typeof settings.sessionDir==='string')projectDir=settings.sessionDir;}
 const selectedDir=intent.sessionDir??process.env.PI_CODING_AGENT_SESSION_DIR??projectDir??host.readGlobalSettings(cwd,agentDir).sessionDir;
 const directory=selectedDir?absolute(selectedDir,cwd):join(agentDir,'sessions','--'+resolve(cwd).replace(/^[/\\]/,'').replace(/[/\\:]/g,'-')+'--');
 const local=await host.sdk.SessionManager.list(cwd,directory);
 const global=async()=>host.sdk.SessionManager.listAll(selectedDir?directory:join(agentDir,'sessions'));
 let list=local,file:string|undefined,globalMatch=false;
 if(intent.kind==='continue')file=[...list].sort((a,b)=>b.modified.getTime()-a.modified.getTime())[0]?.path;
 else if(intent.kind==='resume'){
  const all=await global();list=[...local,...all.filter(s=>!local.some(l=>l.path===s.path))];
  const items=list.map(s=>({id:s.id,path:s.path,title:s.name??s.firstMessage,profileId:readSessionProfile(s.path,host).profile.id}));
  const id=await choose(items);if(!id)throw new Error('会話選択を中止しました');file=list.find(s=>s.id===id)?.path;if(!file)throw new Error('選択会話がありません');
 }else{
  const reference=intent.reference??'';if(reference.includes('/')||reference.includes('\\')||reference.endsWith('.jsonl')){file=absolute(reference,cwd);if(!existsSync(file))throw new Error('会話ファイルがありません');}
  else {let exact=list.filter(s=>s.id===reference),matches=exact.length?exact:list.filter(s=>s.id.startsWith(reference));
   if(!matches.length&&intent.kind!=='session-id'){list=await global();exact=list.filter(s=>s.id===reference);matches=exact.length?exact:list.filter(s=>s.id.startsWith(reference));globalMatch=matches.length>0;}
   if(matches.length>1)throw new Error('会話IDが曖昧です');file=matches[0]?.path;}
 }
 if(!file){
  if(intent.kind==='continue'||intent.kind==='session-id')return {kind:'new',cwd,sessionId:intent.kind==='session-id'?intent.reference:undefined,forwardedArgs:withoutSessionSelectors(intent.originalArgs,new Set(['--continue','-c']))};
  throw new Error('対象会話が見つかりません');
 }
 const canonical=realpathSync(file),saved=readSessionProfile(canonical,host);
 let fork=intent.kind==='fork';
 if(globalMatch&&intent.kind==='session'&&resolve(saved.cwd)!==resolve(cwd)){
  const confirmed=await choose([{id:saved.id,path:canonical,title:'別プロジェクトの会話を現在の場所へforkしますか？',profileId:saved.profile.id}]);if(!confirmed)throw new Error('forkを中止しました');fork=true;
 }
 const targetCwd=fork?cwd:saved.cwd;if(!isAbsolute(targetCwd)||!existsSync(targetCwd))throw new Error('保存会話のcwdを確認してください');
 let forwarded=[...intent.originalArgs];
 if(['continue','resume','session','fork'].includes(intent.kind)){
  forwarded=withoutSessionSelectors(intent.originalArgs,new Set(['--continue','-c','--resume','-r','--session','--fork']));
  const end=optionTerminatorIndex(forwarded);forwarded.splice(end<0?forwarded.length:end,0,fork?'--fork':'--session',canonical);
 }
 return {kind:fork?'fork':'resume',cwd:targetCwd,sessionPath:canonical,sessionId:saved.id,sessionDigest:saved.digest,savedProfile:saved.profile,forwardedArgs:forwarded};
}
