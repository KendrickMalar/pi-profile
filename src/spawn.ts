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
export const realHerdr:Herdr=args=>new Promise(done=>execFile('herdr',args,(error,stdout,stderr)=>done({code:error?(typeof error.code==='number'?error.code:1):0,stdout:String(stdout),stderr:String(stderr)})));
export async function runSpawn(o:{pane:string;name?:string;args:string[];env:NodeJS.ProcessEnv;home:string;herdr:Herdr}):Promise<number>{
 const account=accountFromAgentDir(o.env.PI_CODING_AGENT_DIR,o.home);
 if(!account){process.stderr.write('PI_CODING_AGENT_DIR が既知のアカウントではないため起動を拒否しました\n');return 1;}
 const profileId=o.env.PI_PROFILE_ACTIVE||'standard',command=buildSpawnCommand({profileId,account,args:o.args});
 if(!o.env.PI_PROFILE_ACTIVE)process.stderr.write('PI_PROFILE_ACTIVE がないため標準 Profile で起動しました\n');
 const run=await o.herdr(['pane','run',o.pane,command]);if(run.code!==0){process.stderr.write('herdr pane run が失敗しました (pane '+o.pane+'): '+run.stderr+'\n');return 1;}
 const wait=await o.herdr(['agent','wait',o.pane,'--until','idle','--timeout','120000']);
 if(wait.code!==0){process.stderr.write('子Piの待機に失敗しました。再実行はしていません (pane '+o.pane+'): '+wait.stderr+'\n');return 1;}
 if(o.name){const r=await o.herdr(['agent','rename',o.pane,o.name]);if(r.code!==0){process.stderr.write('名前の変更に失敗しました (pane '+o.pane+'): '+r.stderr+'\n');return 1;}}
 process.stdout.write(JSON.stringify({pane:o.pane,profile:profileId,account})+'\n');return 0;
}
