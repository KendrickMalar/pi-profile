import {existsSync,readFileSync,realpathSync,statSync} from 'node:fs';
import {dirname,join,resolve,delimiter,relative,isAbsolute} from 'node:path';
import {pathToFileURL} from 'node:url';
import type {ProfilePackages} from './package-declarations.ts';
export interface PiHost{
 executable:string;packageRoot:string;version:string;sdk:typeof import('@earendil-works/pi-coding-agent');
 readGlobalSettings(cwd:string,agentDir:string):ReturnType<import('@earendil-works/pi-coding-agent').SettingsManager['getGlobalSettings']>;
 createPackageManager(input:{cwd:string;store:string;packages:ProfilePackages;npmCommand?:string[]}):import('@earendil-works/pi-coding-agent').PackageManager;
}
export function findPiExecutable(input='pi'):string{
 const candidates=input.includes('/')?[resolve(input)]:(process.env.PATH??'').split(delimiter).map(p=>join(p,input));
 const found=candidates.find(p=>existsSync(p)&&statSync(p).isFile());if(!found)throw new Error('Pi実行ファイルが見つかりません');return realpathSync(found);
}
export async function loadPiHost(executable:string):Promise<PiHost>{
 const file=findPiExecutable(executable);let root=dirname(file),manifest:any;
 for(;;){const p=join(root,'package.json');if(existsSync(p)){const m=JSON.parse(readFileSync(p,'utf8'));if(m.name==='@earendil-works/pi-coding-agent'){manifest=m;break;}}const up=dirname(root);if(up===root)throw new Error('npm配置のPiを指定してください');root=up;}
 if(manifest.version!=='1.0.4')throw new Error('新ランチャーはPi 1.0.4で検証されています');
 const entry=manifest.exports?.['.']?.import;if(typeof entry!=='string')throw new Error('Piの公開SDK入口がありません');
 const sdkPath=realpathSync(resolve(root,entry)),rel=relative(root,sdkPath);if(rel.startsWith('..')||isAbsolute(rel))throw new Error('Pi SDK入口がpackage rootから逸脱しています');
 const sdk:PiHost['sdk']=await import(pathToFileURL(sdkPath).href);
 if(typeof sdk.DefaultPackageManager!=='function'||typeof sdk.SessionManager!=='function')throw new Error('Pi SDKが未対応です');
 return {executable:file,packageRoot:root,version:manifest.version,sdk,
  readGlobalSettings:(cwd,agentDir)=>sdk.SettingsManager.create(cwd,agentDir,{projectTrusted:false}).getGlobalSettings(),
  createPackageManager:({cwd,store,packages,npmCommand})=>{const settings=sdk.SettingsManager.inMemory({packages:packages.packages,npmCommand});settings.setProjectTrusted(false);return new sdk.DefaultPackageManager({cwd,agentDir:store,settingsManager:settings});}};
}
