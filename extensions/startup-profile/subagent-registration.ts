import type {ExtensionAPI} from '@earendil-works/pi-coding-agent';
import type {ProfileAgent} from './profile-resources.ts';
export function registerProfileAgents(pi:Pick<ExtensionAPI,'events'>,agents:readonly ProfileAgent[]):{names:string[];warnings:string[];dispose():void} {
 const names:string[]=[],warnings:string[]=[],registrations:{dispose():void}[]=[];
 for(const agent of agents){
  try {
   const request:{version:1;name:string;definition:ProfileAgent['definition'];result?:{ok:boolean;registration?:{dispose():void};error?:unknown}}={version:1,name:agent.name,definition:agent.definition};
   pi.events.emit('pi-subagents:runtime-agent-register:v1',request);
   const r=request.result;
   if(!r)throw new Error('pi-subagents is not installed or does not support runtime registration');
   if(r.ok!==true)throw r.error??new Error('registration rejected');
   if(typeof r.registration?.dispose!=='function')throw new Error('malformed registration response');
   registrations.push(r.registration);names.push(agent.name);
  }catch(error){warnings.push(agent.name+': '+String(error));}
 }
 let disposed=false;
 return {names,warnings,dispose(){if(disposed)return;disposed=true;for(const r of registrations){try{r.dispose();}catch(error){warnings.push('dispose: '+String(error));}}}};
}
