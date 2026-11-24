// scaffold の引き継ぎ（kec-orb-handoff）へ渡す launch 引数を組み立てる。
// 語はすべて安全な文字だけに限る（空白・引用符・改行などを含む語は受け付けない）。
const safeWord=/^[A-Za-z0-9._\/:@+=-]+$/;
// 引き継ぎ先で固定の順に env で渡す変数。空の値は渡さない。
const forwardedEnv=['PI_CODING_AGENT_DIR','DETERMINISTIC_SCAFFOLD_DIR','PI_BROWSER_ACCOUNT'] as const;

// 引き継ぎの分岐に入らないときは undefined を返す。入るときは kec-orb-handoff に渡す引数を返す。
export function scaffoldHandoffArgs(args:string[],env:NodeJS.ProcessEnv,profile:string|undefined):string[]|undefined{
 const at=args.indexOf('--scaffold-handoff');
 if(at<0||!env.KEC_ORB_SESSION||env.KEC_ORB_HANDOFF_RECEIVER)return undefined;
 const packet=args[at+1];
 if(!packet)throw new Error('引き継ぎパケットのパスがありません');
 const prefix=forwardedEnv.flatMap(name=>env[name]?[`${name}=${env[name]}`]:[]);
 const launch=['pi-profile','launch',...(profile?['--profile',profile]:[]),'--',...args];
 const command=['--packet',packet,'--',...(prefix.length?['env',...prefix]:[]),...launch];
 if(!command.every(word=>safeWord.test(word)))throw new Error('引き継ぎの語に使えない文字があります');
 return command;
}
