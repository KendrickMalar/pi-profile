import {fork} from 'node:child_process';import {existsSync} from 'node:fs';import {fileURLToPath} from 'node:url';
import type {PiHost} from './pi-host.ts';import type {ProfilePackages} from './package-declarations.ts';import type {ResolvedProfilePackages} from './package-resolver.ts';
export async function acquireProfilePackages(host:PiHost,id:string,packages:ProfilePackages,home:string,env:NodeJS.ProcessEnv,operation:'resolve'|'install'|'update'='resolve',source?:string,interactive=false):Promise<ResolvedProfilePackages|undefined>{
 const js=fileURLToPath(new URL('./package-worker.js',import.meta.url)),built=fileURLToPath(new URL('../dist/src/package-worker.js',import.meta.url));
 const entry=existsSync(js)?js:existsSync(built)?built:fileURLToPath(new URL('./package-worker.ts',import.meta.url));
 const worker=fork(entry,[],{cwd:process.cwd(),env,execArgv:entry.endsWith('.ts')?['--experimental-strip-types']:[],stdio:[interactive?'inherit':'ignore','pipe','pipe','ipc']});
 worker.stdout?.on('data',chunk=>process.stderr.write(chunk));worker.stderr?.on('data',chunk=>process.stderr.write(chunk));
 const interrupt=()=>worker.kill('SIGINT'),terminate=()=>worker.kill('SIGTERM');process.on('SIGINT',interrupt);process.on('SIGTERM',terminate);
 try{
  return await new Promise((resolve,reject)=>{
   let response:any;
   worker.once('error',reject);worker.on('message',message=>{response=message;});
   worker.once('exit',()=>{if(response?.ok)resolve(response.result);else reject(new Error(response?.error??'取得処理が中断されました'));});
   worker.send({version:1,executable:host.executable,profileId:id,packages,home,operation,source});
  });
 }finally{process.off('SIGINT',interrupt);process.off('SIGTERM',terminate);}
}
