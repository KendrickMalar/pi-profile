import {loadPiHost} from './pi-host.ts';import {resolveProfilePackages,manageProfilePackages} from './package-resolver.ts';
process.once('message',async(message:any)=>{
 try{
  if(message?.version!==1||typeof message.executable!=='string'||typeof message.profileId!=='string'||typeof message.home!=='string'||!Array.isArray(message.packages?.packages))throw new Error('取得要求が不正です');
  const host=await loadPiHost(message.executable);
  const result=message.operation==='resolve'?await resolveProfilePackages(host,message.profileId,message.packages,message.home):await manageProfilePackages(host,message.profileId,message.packages,message.home,message.operation,message.source);
  process.send?.({ok:true,result},()=>process.exit(0));
 }catch(error){process.send?.({ok:false,error:error instanceof Error?error.message:'パッケージ取得に失敗しました'},()=>process.exit(1));}
});
