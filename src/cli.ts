#!/usr/bin/env node
import {readFileSync,existsSync,realpathSync} from 'node:fs';import {homedir} from 'node:os';import {dirname,join,resolve} from 'node:path';import {fileURLToPath,pathToFileURL} from 'node:url';
import {loadPiHost,findPiExecutable,type PiHost} from './pi-host.ts';import {parseSessionIntent} from './session-intent.ts';import {resolveSessionTarget} from './session-target.ts';
import {selectStartupProfile} from './select-profile.ts';import {resolveProfileRoot} from '../extensions/startup-profile/profile-root.ts';import {loadProfiles,STANDARD_PROFILE,type ProfileDefinition} from '../extensions/startup-profile/catalog.ts';
import {loadProfilePackages,changeProfilePackages,normalizeSource} from './package-declarations.ts';import {resolveProfilePackages,manageProfilePackages} from './package-resolver.ts';import {launchPi,spawnNativePi,startupExtension} from './launch.ts';
import {acquireProfilePackages} from './package-worker-client.ts';
const help='pi-profile launch [--profile ID] -- [Pi args...]\npi-profile packages <list|add|remove|install|update> --profile ID [SOURCE] [--replace]\n';
function ownOptions(args:string[]):{profile?:string;replace:boolean;source?:string}{
 let profile:string|undefined,replace=false,source:string|undefined;
 for(let i=0;i<args.length;i++){const v=args[i];if(v==='--profile'){profile=args[++i];if(!profile)throw new Error('--profileの値がありません');}
  else if(v==='--replace')replace=true;else if(v.startsWith('-'))throw new Error('ランチャー引数が不正です。Pi引数は--の後へ指定してください');else if(source===undefined)source=v;else throw new Error('sourceは1個だけ指定してください');}
 return{profile,replace,source};
}
function profiles(home:string,env:NodeJS.ProcessEnv):{root?:string;definitions:ProfileDefinition[]}{
 const r=resolveProfileRoot({home,override:env.PI_PROFILE_DIR});
 if(!r.directory||!existsSync(r.directory))return{root:r.directory,definitions:[{...STANDARD_PROFILE}]};
 const loaded=loadProfiles(r.directory);for(const w of loaded.warnings)process.stderr.write(w+'\n');return{root:r.directory,definitions:loaded.profiles};
}
async function uiWidth(host:PiHost):Promise<(text:string,width:number)=>string>{
 let directory=host.packageRoot;
 for(;;){const root=join(directory,'node_modules/@earendil-works/pi-tui'),p=join(root,'package.json');
  if(existsSync(p)){const m=JSON.parse(readFileSync(p,'utf8')),entry=m.exports?.['.']?.import??m.main;const ui=await import(pathToFileURL(resolve(root,entry)).href);return(text,width)=>ui.truncateToWidth(text,width);}
  const up=dirname(directory);if(up===directory)throw new Error('対象PiのTUI依存が見つかりません');directory=up;}
}
async function choose(items:ReadonlyArray<{id:string;label:string;description:string}>,title:string,host:PiHost):Promise<{kind:'selected';id:string}|{kind:'escape'}|{kind:'cancel'}>{
 if(!process.stdin.isTTY||!process.stdout.isTTY)throw new Error('選択には端末が必要です。--sessionまたは--profileを指定してください');
 if(!items.length)throw new Error('選択候補がありません');const clip=await uiWidth(host);let selected=0,rows=0,buffer='',escape:ReturnType<typeof setTimeout>|undefined;
 const raw=process.stdin.isRaw;process.stdin.setRawMode(true);process.stdin.resume();
 return await new Promise(resolveChoice=>{
  const clean=()=>{if(escape)clearTimeout(escape);process.stdin.off('data',input);process.stdout.off('resize',render);process.stdin.setRawMode(raw);process.stdin.pause();if(rows)process.stdout.write('\x1b['+rows+'A\r'+Array.from({length:rows},()=> '\x1b[2K\n').join('')+'\x1b['+rows+'A\r');};
  const finish=(choice:any)=>{clean();resolveChoice(choice);};
  const render=()=>{if(rows)process.stdout.write('\x1b['+rows+'A\r');const width=Math.max(1,process.stdout.columns??80),count=Math.max(1,(process.stdout.rows??24)-4),start=Math.max(0,selected-count+1);
   const lines=[title,...items.slice(start,start+count).map((x,i)=>(start+i===selected?'> ':'  ')+'['+x.id+'] '+x.label+' — '+x.description),'↑↓ 選択 / Enter 決定 / Esc Other / Ctrl-C 中止'];
   const old=rows;rows=lines.length;for(const line of lines)process.stdout.write('\x1b[2K'+clip(line.replace(/[\x00-\x1f\x7f]/g,' '),width)+'\n');if(old>rows){process.stdout.write(Array.from({length:old-rows},()=> '\x1b[2K\n').join('')+'\x1b['+(old-rows)+'A');}};
  const input=(data:Buffer)=>{buffer+=data.toString();if(escape){clearTimeout(escape);escape=undefined;}
   while(buffer){if(buffer.startsWith('\x1b[A')){selected=Math.max(0,selected-1);buffer=buffer.slice(3);render();}
    else if(buffer.startsWith('\x1b[B')){selected=Math.min(items.length-1,selected+1);buffer=buffer.slice(3);render();}
    else if(buffer==='\x1b'||buffer==='\x1b['){escape=setTimeout(()=>finish({kind:'escape'}),40);break;}
    else {const key=buffer[0];buffer=buffer.slice(1);if(key==='\x03'){finish({kind:'cancel'});return;}if(key==='\r'||key==='\n'){finish({kind:'selected',id:items[selected].id});return;}if(key==='\x1b'){finish({kind:'escape'});return;}}}};
  process.stdin.on('data',input);process.stdout.on('resize',render);render();
 });
}
function sameRegistration(host:PiHost,root:string,agentDir:string,args:string[]){
 if(args.includes('--no-extensions')||args.includes('-ne'))return;
 const global=host.readGlobalSettings(process.cwd(),agentDir),manager=host.sdk.DefaultPackageManager;
 const m=new manager({cwd:process.cwd(),agentDir,settingsManager:host.sdk.SettingsManager.inMemory(global)});
 for(const p of global.packages??[]){const s=typeof p==='string'?p:p.source;const path=m.getInstalledPath(s,'user');if(!path)continue;
  const manifest=join(path,'package.json');if(existsSync(manifest)&&JSON.parse(readFileSync(manifest,'utf8')).name==='pi-profile'&&realpathSync(path)!==realpathSync(root))throw new Error('起動CLIと共通登録のpi-profile実体が違います。導入時に同じ実体へ合わせてください');}
}
export async function runCli(argv:string[],env:NodeJS.ProcessEnv):Promise<number>{
 if(!argv.length||argv[0]==='--help'||argv[0]==='-h'){process.stdout.write(help);return 0;}
 const command=argv[0],home=env.HOME??homedir(),bin=env.PI_PROFILE_PI_BIN??'pi';
 if(command==='launch'){
  const sep=argv.indexOf('--'),options=ownOptions(sep<0?argv.slice(1):argv.slice(1,sep)),args=sep<0?[]:argv.slice(sep+1);
  if(options.source||options.replace)throw new Error('launch引数が不正です');
  const intent=parseSessionIntent(args,{stdin:Boolean(process.stdin.isTTY),stdout:Boolean(process.stdout.isTTY)});
  if(intent.kind==='passthrough')return spawnNativePi(findPiExecutable(bin),args,env);
  const host=await loadPiHost(bin),agentDir=env.PI_CODING_AGENT_DIR??join(home,'.pi/agent'),p=profiles(home,env);
  const target=await resolveSessionTarget(host,intent,process.cwd(),agentDir,async(items)=>{
   const result=await choose(items.map(i=>({id:i.id,label:i.title,description:i.profileId})),'再開する会話',host);return result.kind==='selected'?result.id:null;});
  const selected=await selectStartupProfile(target,p.definitions,options.profile,async(items)=>{
   if(intent.mode!=='tui')return{kind:'selected',id:'standard'};
   return choose(items.map(i=>{const definition=p.definitions.find(p=>p.id===i.id);let names='';try{names=definition?.directory?loadProfilePackages(definition.directory).packages.join(', '):'';}catch{names='パッケージ宣言を確認してください';}return{id:i.id,label:i.label,description:i.description+(names?' / '+names:'')};}),'起動するProfile',host);});
  if(!selected)return 130;
  const definition=p.definitions.find(p=>p.id===selected.id);if(!definition&&selected.id!=='standard')throw new Error('保存Profileの定義がありません。PI_PROFILE_LAUNCHER=0で従来起動するか定義を復旧してください');
  const declaration=definition?.directory?loadProfilePackages(definition.directory):{version:1 as const,packages:[]};
  const resolved=await acquireProfilePackages(host,selected.id,declaration,home,env,'resolve',undefined,intent.mode==='tui');if(!resolved)throw new Error('パッケージ解決結果がありません');
  let root=dirname(startupExtension);while(!existsSync(join(root,'package.json'))||JSON.parse(readFileSync(join(root,'package.json'),'utf8')).name!=='pi-profile'){const up=dirname(root);if(up===root)throw new Error('pi-profile package rootが不明です');root=up;}
  sameRegistration(host,root,agentDir,args);
  return launchPi({host,target,profile:selected,packages:resolved,env,profileRoot:p.root});
 }
 if(command==='packages'){
  const action=argv[1],options=ownOptions(argv.slice(2));if(!options.profile)throw new Error('--profileを指定してください');
  const p=profiles(home,env),definition=p.definitions.find(p=>p.id===options.profile);if(!definition?.directory)throw new Error('対象Profileフォルダがありません');
  if(action==='list'){process.stdout.write(JSON.stringify(loadProfilePackages(definition.directory),null,2)+'\n');return 0;}
  if(action==='add'||action==='remove'){if(!options.source)throw new Error('sourceを指定してください');await changeProfilePackages(definition.directory,action,options.source,options.replace);return 0;}
  if(action==='install'||action==='update'){const host=await loadPiHost(bin);await acquireProfilePackages(host,definition.id,loadProfilePackages(definition.directory),home,env,action,options.source?normalizeSource(options.source,definition.directory):undefined,Boolean(process.stdin.isTTY&&process.stdout.isTTY));return 0;}
  throw new Error('packages操作が不明です');
 }
 throw new Error('操作が不明です。--helpを確認してください');
}
if(process.argv[1]&&existsSync(process.argv[1])&&realpathSync(process.argv[1])===fileURLToPath(import.meta.url)){
 const finish=async(code:number)=>{await Promise.all([new Promise<void>(resolve=>process.stdout.write('',()=>resolve())),new Promise<void>(resolve=>process.stderr.write('',()=>resolve()))]);process.exit(code);};
 runCli(process.argv.slice(2),process.env).then(code=>finish(code),error=>{process.stderr.write((error instanceof Error?error.message:'起動に失敗しました')+'\n');return finish(1);});
}
