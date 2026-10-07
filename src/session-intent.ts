export interface SessionIntent{kind:'new'|'continue'|'resume'|'session'|'session-id'|'fork'|'ephemeral'|'passthrough';mode:'tui'|'print'|'json'|'rpc';reference?:string;sessionDir?:string;originalArgs:string[]}
const values=new Set(['--provider','--model','--api-key','--system-prompt','--append-system-prompt','--name','-n','--session','--session-id','--fork','--session-dir','--models','--tools','-t','--exclude-tools','-xt','--thinking','--extension','-e','--skill','--prompt-template','--theme','--use-theme','--tui-mode']);

function argumentTokens(args:string[]):Array<{index:number;key:string;valueIndex?:number}>{
 const result:Array<{index:number;key:string;valueIndex?:number}>=[];
 for(let i=0;i<args.length;i++){
  const key=args[i];if(key==='--'){result.push({index:i,key});break;}
  const next=args[i+1];
  const valued=values.has(key)||key==='--mode'||((key==='--print'||key==='-p')&&next!==undefined&&!next.startsWith('@')&&(!next.startsWith('-')||next.startsWith('---')))||(key.startsWith('--')&&!['--continue','--resume','--no-session','--help','--version','--offline','--no-extensions','--no-tools','--no-builtin-tools','--no-skills','--no-prompt-templates','--no-themes','--no-mcp','--no-context-files','--approve','--no-approve','--verbose'].includes(key)&&next!==undefined&&!next.startsWith('-'));
  result.push({index:i,key,valueIndex:valued?i+1:undefined});if(valued)i++;
 }return result;
}
export function withoutSessionSelectors(args:string[],drop:ReadonlySet<string>):string[]{
 const omit=new Set<number>();for(const t of argumentTokens(args))if(drop.has(t.key)){omit.add(t.index);if(t.valueIndex!==undefined)omit.add(t.valueIndex);}
 return args.filter((_x,i)=>!omit.has(i));
}
export function optionTerminatorIndex(args:string[]):number{return argumentTokens(args).find(t=>t.key==='--')?.index??-1;}
export function parseSessionIntent(args:string[],tty:{stdin:boolean;stdout:boolean}):SessionIntent{
 let mode:SessionIntent['mode']=tty.stdin&&tty.stdout?'tui':'print',kind:SessionIntent['kind']='new',reference:string|undefined,sessionDir:string|undefined;
 const selectors=new Set<string>();let print=false,noSession=false,sessionId:string|undefined;
 if(['install','remove','uninstall','update','list','config','auth','mcp','completion'].includes(args[0]??''))kind='passthrough';
 for(let i=0;i<args.length;i++){
  const x=args[i];if(x==='--')break;
  if(['--help','-h','--version','-v','--export','--list-models'].includes(x))kind='passthrough';
  if(x==='--mode'){const v=args[++i];if(!['text','json','rpc'].includes(v??''))throw new Error('--modeが不正です');if(v!=='text')mode=v as 'json'|'rpc';continue;}
  if(x==='--print'||x==='-p'){print=true;if(args[i+1]&&!args[i+1].startsWith('-')&&!args[i+1].startsWith('@'))i++;continue;}
  if(x==='--continue'||x==='-c'){selectors.add('continue');kind='continue';continue;}
  if(x==='--resume'||x==='-r'){selectors.add('resume');kind='resume';continue;}
  if(x==='--no-session'){noSession=true;continue;}
  if(values.has(x)){const value=args[++i];if(value===undefined)throw new Error('Pi引数の値が不足しています');
   if(x==='--session'||x==='--fork'){const k=x==='--session'?'session':'fork';selectors.add(k);kind=k;reference=value;}
   if(x==='--session-id')sessionId=value;if(x==='--session-dir')sessionDir=value;continue;}
  if(x.startsWith('--')&&args[i+1]&&!args[i+1].startsWith('-'))i++;
 }
 if(selectors.size>1||(noSession&&selectors.size)||(sessionId&&[...selectors].some(x=>x!=='fork')))throw new Error('会話指定の組み合わせが不正です');
 if(kind!=='passthrough'&&sessionId&&!selectors.size){kind='session-id';reference=sessionId;}
 if(kind!=='passthrough'&&noSession){kind='ephemeral';reference=sessionId;}
 if(print&&mode!=='rpc'&&mode!=='json')mode='print';
 return {kind,mode,reference,sessionDir,originalArgs:[...args]};
}
