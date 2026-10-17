import {execFile} from 'node:child_process';import {join,resolve} from 'node:path';
export type Account='kuno'|'muu'|'rbx';
export type Herdr=(args:string[])=>Promise<{code:number;stdout:string;stderr:string}>;
const SAFE=/^[A-Za-z0-9._\/:@+-]+$/;
export function accountFromAgentDir(agentDir:string|undefined,home:string):Account|undefined{
 if(!agentDir)return 'kuno';const dir=resolve(agentDir);
 for(const[name,account]of[['agent','kuno'],['agent-muu','muu'],['agent-rbx','rbx']]as const)if(dir===resolve(join(home,'.pi',name)))return account;
 return undefined;
}
export function buildSpawnCommand(o:{profileId:string;account:Account;args:string[]}):string{
 for(const v of[o.profileId,o.account,...o.args])if(!SAFE.test(v))throw new Error('spawnに渡せない文字が含まれています: '+v);
 return['env','PI_PROFILE_ID='+o.profileId,'pi-account',o.account,...o.args].join(' ');
}
export function execFileError(error:Error|null,stderr:string):string{return stderr||(error?error.message:'');}
export const realHerdr:Herdr=args=>new Promise(done=>execFile('herdr',args,(error,stdout,stderr)=>done({code:error?(typeof error.code==='number'?error.code:1):0,stdout:String(stdout),stderr:execFileError(error,String(stderr))})));
type Rec=Record<string,unknown>;const isRec=(v:unknown):v is Rec=>typeof v==='object'&&v!==null&&!Array.isArray(v);
const parse=(text:string):Rec|undefined=>{try{const v=JSON.parse(text);return isRec(v)?v:undefined;}catch{return undefined;}};
const SHELLS=/^-?(zsh|bash|fish|sh|dash|ksh)$/;
// pi-scaffold の herdr-client.ts processInfo と同じ規則。
export function shellReady(stdout:string):boolean{
 const r=parse(stdout),info=r&&isRec(r.result)&&isRec(r.result.process_info)?r.result.process_info:undefined;if(!info)return false;
 if(typeof info.shell_pid==='number')return info.shell_pid===info.foreground_process_group_id;
 const procs=Array.isArray(info.foreground_processes)?info.foreground_processes.filter(isRec):[];
 return procs.length===1&&SHELLS.test(String(procs[0].name??''));
}
const READY=new Set(['idle','done','blocked']);// herdr agent wait の既定と同じ
export function piReady(stdout:string):boolean{
 const r=parse(stdout),pane=r&&isRec(r.result)&&isRec(r.result.pane)?r.result.pane:undefined;
 return pane?.agent==='pi'&&typeof pane.agent_status==='string'&&READY.has(pane.agent_status);
}
export const READY_TIMEOUT_MS=120000,POLL_MS=1000;
export async function runSpawn(o:{pane:string;name?:string;args:string[];env:NodeJS.ProcessEnv;home:string;herdr:Herdr;now?:()=>number;sleep?:(ms:number)=>Promise<void>}):Promise<number>{
 const now=o.now??Date.now,sleep=o.sleep??(ms=>new Promise<void>(r=>setTimeout(r,ms)));
 const account=accountFromAgentDir(o.env.PI_CODING_AGENT_DIR,o.home);
 if(!account){process.stderr.write('PI_CODING_AGENT_DIR が既知のアカウントではないため起動を拒否しました\n');return 1;}
 const profileId=o.env.PI_PROFILE_ACTIVE||'standard',command=buildSpawnCommand({profileId,account,args:o.args});
 const info=await o.herdr(['pane','process-info','--pane',o.pane]);
 if(info.code!==0){process.stderr.write('pane の状態を確認できませんでした。何も実行していません (pane '+o.pane+'): '+info.stderr+'\n');return 1;}
 if(!shellReady(info.stdout)){process.stderr.write('pane が待機中のシェルではありません。何も実行していません (pane '+o.pane+')\n');return 1;}
 if(!o.env.PI_PROFILE_ACTIVE)process.stderr.write('PI_PROFILE_ACTIVE がないため標準 Profile で起動しました\n');
 const run=await o.herdr(['pane','run',o.pane,command]);if(run.code!==0){process.stderr.write('herdr pane run が失敗しました (pane '+o.pane+'): '+run.stderr+'\n');return 1;}
 const deadline=now()+READY_TIMEOUT_MS;
 for(;;){
  const got=await o.herdr(['pane','get',o.pane]);if(got.code===0&&piReady(got.stdout))break;
  if(now()+POLL_MS>deadline){process.stderr.write('子Piが '+READY_TIMEOUT_MS+' ms 以内に待機状態になりませんでした。再実行はしていません (pane '+o.pane+')\n');return 1;}
  await sleep(POLL_MS);
 }
 if(o.name){const r=await o.herdr(['agent','rename',o.pane,o.name]);if(r.code!==0){process.stderr.write('名前の変更に失敗しました (pane '+o.pane+'): '+r.stderr+'\n');return 1;}}
 process.stdout.write(JSON.stringify({pane:o.pane,profile:profileId,account})+'\n');return 0;
}
