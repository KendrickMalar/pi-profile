import {spawn} from 'node:child_process';import {randomUUID,createHash} from 'node:crypto';import {readFileSync,realpathSync,existsSync} from 'node:fs';import {tmpdir} from 'node:os';import {fileURLToPath} from 'node:url';
import type {PiHost} from './pi-host.ts';import type {SessionTarget} from './session-target.ts';import type {ProfileSnapshot} from '../extensions/startup-profile/state.ts';import type {ResolvedProfilePackages} from './package-resolver.ts';
import {writeLaunchContext} from './launch-context.ts';import {optionTerminatorIndex} from './session-intent.ts';
const sourceEntry=fileURLToPath(new URL('../extensions/startup-profile/index.ts',import.meta.url));
export const startupExtension=existsSync(sourceEntry)?sourceEntry:fileURLToPath(new URL('../../extensions/startup-profile/index.ts',import.meta.url));
export async function spawnNativePi(executable:string,args:string[],env:NodeJS.ProcessEnv):Promise<number>{
 const child=spawn(executable,args,{cwd:process.cwd(),env,stdio:'inherit'});
 const signal=(name:NodeJS.Signals)=>{if(child.exitCode===null&&child.signalCode===null)child.kill(name);};
 const interrupt=()=>signal('SIGINT'),terminate=()=>signal('SIGTERM');
 process.on('SIGINT',interrupt);process.on('SIGTERM',terminate);
 try{return await new Promise<number>((resolve,reject)=>{child.once('error',reject);child.once('exit',(code,signal)=>resolve(code??(signal==='SIGINT'?130:143)));});}
 finally{process.off('SIGINT',interrupt);process.off('SIGTERM',terminate);}
}
export async function launchPi(input:{host:PiHost;target:SessionTarget;profile:ProfileSnapshot;packages:ResolvedProfilePackages;env:NodeJS.ProcessEnv;profileRoot?:string}):Promise<number>{
 if(input.target.sessionPath&&input.target.sessionDigest){const current=createHash('sha256').update(readFileSync(input.target.sessionPath)).digest('hex');if(current!==input.target.sessionDigest)throw new Error('会話が選択後に変更されました。もう一度起動してください');}
 const context={version:1 as const,profile:input.profile,profileRoot:input.profileRoot,packages:input.packages,target:input.target,ownerPid:process.pid,nonce:randomUUID()};
 const args=[...input.target.forwardedArgs],extra=['-e',realpathSync(startupExtension)];
 for(const root of input.packages.resourceRoots)extra.push('-e',root);
 const end=optionTerminatorIndex(args);args.splice(end<0?args.length:end,0,...extra);
 const owned=await writeLaunchContext(context,tmpdir());
 try{return await spawnNativePi(input.host.executable,args,{...input.env,PI_PROFILE_PI_BIN:input.host.executable,PI_PROFILE_LAUNCH_CONTEXT:owned.path});}
 finally{await owned.dispose();}
}
