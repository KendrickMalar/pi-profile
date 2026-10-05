import test from "node:test";
import assert from "node:assert/strict";
import { readSnapshot, snapshotProfile, decideSessionProfile } from "../../extensions/startup-profile/state.ts";
const saved = {version:1,id:"developer",label:"開発",instructions:"fixed development"};
const entry = (data: unknown) => ({type:"custom",customType:"startup-profile-state",data});
test("round trips profile content independently of the definition",()=>{
 const snap=snapshotProfile({id:"developer",label:"開発",description:"unused",instructions:"fixed development"});
 assert.deepEqual(snap,saved); assert.deepEqual(readSnapshot([entry(saved)]),{snapshot:saved,invalid:false});
});
test("restores deleted definition from literal snapshot",()=>{
 assert.equal(readSnapshot([entry(saved)]).snapshot?.instructions,"fixed development");
});
test("ignores other extension entries",()=>assert.deepEqual(readSnapshot([{type:"custom",customType:"other",data:null}]),{invalid:false}));
for(const data of [null,{}, {...saved,version:2},{...saved,label:"bad\nlabel"},{...saved,id:"../escape"},{...saved,instructions:32},{...saved,id:"standard"}]) test("invalid snapshot is not restored "+JSON.stringify(data),()=>{
 assert.deepEqual(readSnapshot([entry(data)]),{invalid:true});
});
test("contradictory immutable snapshots are invalid",()=>assert.deepEqual(readSnapshot([entry(saved),entry({...saved,instructions:"different"})]),{invalid:true}));
test("identical repeated snapshots are accepted",()=>assert.deepEqual(readSnapshot([entry(saved),entry({...saved})]),{snapshot:saved,invalid:false}));
test("wrong entry type cannot masquerade as valid state",()=>assert.deepEqual(readSnapshot([{type:"message",customType:"startup-profile-state",data:saved}]),{invalid:true}));
const base={reason:"startup" as const,mode:"tui" as const,existingFile:false,hasConversation:false,restored:{invalid:false}};
const rows = [
 ["new interactive startup",{}, "select"],
 ["new command",{reason:"new"},"select"],
 ["old empty file",{existingFile:true},"standard"],
 ["startup resumed conversation",{hasConversation:true},"standard"],
 ["reload",{reason:"reload"},"standard"],
 ["resume",{reason:"resume"},"standard"],
 ["fork legacy",{reason:"fork"},"standard"],
 ["print",{mode:"print"},"standard"],
 ["json",{mode:"json"},"standard"],
 ["rpc",{mode:"rpc"},"standard"],
 ["invalid stored data",{restored:{invalid:true}},"standard"],
 ["restore named snapshot",{restored:{snapshot:saved,invalid:false}},"restore"],
 ["restore in print",{mode:"print",restored:{snapshot:saved,invalid:false}},"restore"],
 ["restore after reload",{reason:"reload",restored:{snapshot:saved,invalid:false}},"restore"],
 ["restore fork",{reason:"fork",restored:{snapshot:saved,invalid:false}},"restore"],
] as const;
for (const [name,patch,want] of rows) test(name,()=>assert.equal(decideSessionProfile({...base,...patch} as any),want));
