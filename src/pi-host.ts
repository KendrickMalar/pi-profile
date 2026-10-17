import {existsSync,readFileSync,realpathSync,statSync} from 'node:fs';
import {dirname,join,resolve,delimiter,relative,isAbsolute} from 'node:path';
import {pathToFileURL} from 'node:url';
import type {ProfilePackages} from './package-declarations.ts';
export interface PiHost{
 executable:string;packageRoot:string;version:string;sdk:typeof import('@earendil-works/pi-coding-agent');
 readGlobalSettings(cwd:string,agentDir:string):ReturnType<import('@earendil-works/pi-coding-agent').SettingsManager['getGlobalSettings']>;
 createPackageManager(input:{cwd:string;store:string;packages:ProfilePackages;npmCommand?:string[]}):import('@earendil-works/pi-coding-agent').PackageManager;
}
// 1.0.4で検証済み。1.x系はSDK互換を前提に許可し、実際に使うAPIの有無で弾く。
export const MIN_PI_VERSION='1.0.4';
export function isSupportedPiVersion(version:unknown):boolean{
 const m=typeof version==='string'?/^(\d+)\.(\d+)\.(\d+)$/.exec(version):null;if(!m)return false;
 const [major,minor,patch]=m.slice(1).map(Number),[, ,minPatch]=MIN_PI_VERSION.split('.').map(Number);
 return major===1&&(minor>0||patch>=minPatch);
}
export function missingSdkApis(sdk:any):string[]{
 const checks:[string,unknown][]=[['DefaultPackageManager',sdk?.DefaultPackageManager],['SessionManager',sdk?.SessionManager],['SessionManager.list',sdk?.SessionManager?.list],['SessionManager.listAll',sdk?.SessionManager?.listAll],['SettingsManager.create',sdk?.SettingsManager?.create],['SettingsManager.inMemory',sdk?.SettingsManager?.inMemory],['parseSessionEntries',sdk?.parseSessionEntries]];
 return checks.filter(([,v])=>typeof v!=='function').map(([k])=>k);
}
export function findPiExecutable(input='pi'):string{
 const candidates=input.includes('/')?[resolve(input)]:(process.env.PATH??'').split(delimiter).map(p=>join(p,input));
 const found=candidates.find(p=>existsSync(p)&&statSync(p).isFile());if(!found)throw new Error('Pi実行ファイルが見つかりません');return realpathSync(found);
}
function findPiPackage(file:string):{root:string;manifest:any}|undefined{
 let root=dirname(file);
 for(;;){const p=join(root,'package.json');if(existsSync(p)){try{const m=JSON.parse(readFileSync(p,'utf8'));if(m.name==='@earendil-works/pi-coding-agent')return{root,manifest:m};}catch{}}const up=dirname(root);if(up===root)return undefined;root=up;}
}
// PATHの先頭にshim（~/.local/bin/pi）があっても飛ばし、実体がPiのnpmパッケージ内にある最初のpiを採る。
export function findRealPiOnPath(path:string|undefined):string{
 for(const dir of (path??'').split(delimiter)){if(!dir)continue;const p=join(dir,'pi');
  try{if(!existsSync(p)||!statSync(p).isFile())continue;const real=realpathSync(p);if(findPiPackage(real))return real;}catch{}}
 throw new Error('Pi実行ファイルが見つかりません（PATH上にnpm配置のPiがありません。PI_PROFILE_PI_BINで指定できます）');
}
export function piBinFromEnv(env:NodeJS.ProcessEnv):string{return env.PI_PROFILE_PI_BIN??findRealPiOnPath(env.PATH);}
export async function loadPiHost(executable:string):Promise<PiHost>{
 const file=findPiExecutable(executable),found=findPiPackage(file);if(!found)throw new Error('npm配置のPiを指定してください');const {root,manifest}=found;
 if(!isSupportedPiVersion(manifest.version))throw new Error(`新ランチャーはPi ${MIN_PI_VERSION}以上・2.0未満に対応しています（検出: ${manifest.version}）`);
 const entry=manifest.exports?.['.']?.import;if(typeof entry!=='string')throw new Error('Piの公開SDK入口がありません');
 const sdkPath=realpathSync(resolve(root,entry)),rel=relative(root,sdkPath);if(rel.startsWith('..')||isAbsolute(rel))throw new Error('Pi SDK入口がpackage rootから逸脱しています');
 const sdk:PiHost['sdk']=await import(pathToFileURL(sdkPath).href);
 const missing=missingSdkApis(sdk);if(missing.length)throw new Error(`Pi ${manifest.version} のSDKが未対応です（不足: ${missing.join(', ')}）`);
 return {executable:file,packageRoot:root,version:manifest.version,sdk,
  readGlobalSettings:(cwd,agentDir)=>sdk.SettingsManager.create(cwd,agentDir,{projectTrusted:false}).getGlobalSettings(),
  createPackageManager:({cwd,store,packages,npmCommand})=>{const settings=sdk.SettingsManager.inMemory({packages:packages.packages,npmCommand});settings.setProjectTrusted(false);return new sdk.DefaultPackageManager({cwd,agentDir:store,settingsManager:settings});}};
}
