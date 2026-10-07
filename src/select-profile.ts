import {snapshotProfile,type ProfileSnapshot} from '../extensions/startup-profile/state.ts';import {STANDARD_PROFILE,type ProfileDefinition} from '../extensions/startup-profile/catalog.ts';
import type {SessionTarget} from './session-target.ts';
export type ProfileChoice={kind:'selected';id:string}|{kind:'escape'}|{kind:'cancel'};
export type ProfileChooser=(items:ReadonlyArray<{id:string;label:string;description:string;packages:string[]}>)=>Promise<ProfileChoice>;
export async function selectStartupProfile(target:SessionTarget,profiles:ProfileDefinition[],explicit:string|undefined,choose:ProfileChooser):Promise<ProfileSnapshot|null>{
 if(target.savedProfile){if(explicit&&explicit!==target.savedProfile.id)throw new Error('保存Profileと指定が一致しません');return target.savedProfile;}
 if(explicit){const p=profiles.find(p=>p.id===explicit);if(!p)throw new Error('指定Profileがありません');return snapshotProfile(p);}
 const choice=await choose(profiles.map(p=>({id:p.id,label:p.label,description:p.description,packages:[]})));
 if(choice.kind==='cancel')return null;if(choice.kind==='escape')return snapshotProfile(STANDARD_PROFILE);
 const selected=profiles.find(p=>p.id===choice.id);if(!selected)throw new Error('選択Profileがありません');return snapshotProfile(selected);
}
