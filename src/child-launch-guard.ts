export const CHILD_LAUNCH_BLOCK_REASON='子の pi は pi-profile spawn --pane <pane ID> [--name <名前>] [-- <pi の引数>] で起動してください。親の Profile とアカウントを引き継ぎます。herdr agent start --kind pi や herdr pane run での素の pi は、Profile のツールが入らないため使えません。';

// Split into simple commands on && ; | (and newlines) outside quotes; each is a list of unquoted words.
function simpleCommands(command:string):string[][]{
 const out:string[][]=[];let words:string[]=[];let word='';let has=false;let quote='';
 const endWord=()=>{if(has)words.push(word);word='';has=false;};
 const endCommand=()=>{endWord();if(words.length)out.push(words);words=[];};
 for(let i=0;i<command.length;i++){
  const c=command[i];
  if(quote){if(c===quote)quote='';else if(c==='\\'&&quote==='"'&&i+1<command.length)word+=command[++i];else word+=c;continue;}
  if(c==='"'||c==="'"){quote=c;has=true;}
  else if(c==='\\'&&i+1<command.length){word+=command[++i];has=true;}
  else if(c===';'||c==='|'||c==='&'||c==='\n')endCommand();
  else if(/\s/.test(c))endWord();
  else{word+=c;has=true;}
 }
 endCommand();
 return out;
}

export function plainPiLaunch(command:string):boolean{
 return simpleCommands(command).some(words=>{
  if(words[0]!=='herdr')return false;
  let i=1;
  while(i<words.length&&words[i].startsWith('-')){i+=words[i].includes('=')?1:2;}
  const rest=words.slice(i);
  if(rest[0]==='agent'&&rest[1]==='start')return rest.some((w,j)=>w==='--kind=pi'||(w==='--kind'&&rest[j+1]==='pi'));
  if(rest[0]==='pane'&&rest[1]==='run')return rest[3]?.trim().split(/\s+/)[0]==='pi';
  return false;
 });
}
