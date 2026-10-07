import test from 'node:test';import assert from 'node:assert/strict';import {existsSync} from 'node:fs';
async function api(){const u=new URL('../../src/session-intent.ts',import.meta.url);assert.ok(existsSync(u),'session intent not implemented');return import(u.href);}
test('known flag values and literal -- tail are not session switches; argv is preserved',async()=>{
 const a=await api(),args=['--model','--session','--','--resume','日本語 prompt'];
 const r=a.parseSessionIntent(args,{stdin:true,stdout:true});assert.equal(r.kind,'new');assert.deepEqual(r.originalArgs,args);
 for(const [args,kind,mode] of [[['-c'],'continue','tui'],[['--resume'],'resume','tui'],[['--session','id'],'session','tui'],[['--session-id','id'],'session-id','tui'],[['--fork','id'],'fork','tui'],[['--no-session'],'ephemeral','tui'],[['--print','hello'],'new','print'],[['--mode','rpc'],'new','rpc'],[['--mode','json'],'new','json'],[['--help'],'passthrough','tui'],[['install','npm:x'],'passthrough','tui']] as const){
  const r=a.parseSessionIntent([...args],{stdin:true,stdout:true});assert.equal(r.kind,kind);assert.equal(r.mode,mode);
 }
 assert.equal(a.parseSessionIntent([],{stdin:false,stdout:true}).mode,'print');
 assert.throws(()=>a.parseSessionIntent(['--continue','--session','id'],{stdin:true,stdout:true}));
});
