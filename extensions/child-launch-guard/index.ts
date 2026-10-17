import type {ExtensionAPI} from '@earendil-works/pi-coding-agent';
import {plainPiLaunch,CHILD_LAUNCH_BLOCK_REASON} from '../../src/child-launch-guard.ts';

export default function childLaunchGuard(pi:ExtensionAPI):void{
 pi.on('tool_call',async event=>{
  if(process.env.PI_SUBAGENT_CHILD==='1'||event.toolName!=='bash')return;
  const command=(event.input as {command?:unknown}).command;
  if(typeof command==='string'&&plainPiLaunch(command))return {block:true,reason:CHILD_LAUNCH_BLOCK_REASON};
 });
}
