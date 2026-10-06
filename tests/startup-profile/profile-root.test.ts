import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveProfileRoot } from '../../extensions/startup-profile/profile-root.ts';
for (const [name,override,directory] of [
 ['default_home',undefined,'/fixture/home/.pi/agent/profiles'],
 ['empty_override','','/fixture/home/.pi/agent/profiles'],
 ['absolute_override','/fixture/custom','/fixture/custom'],
 ['tilde_override','~/custom','/fixture/home/custom'],
 ['tilde_double_slash','~//fixture/profiles','/fixture/home/fixture/profiles'],
 ['tilde_triple_slash','~///fixture/profiles','/fixture/home/fixture/profiles'],
 ['absolute_path_with_spaces','/fixture/custom name','/fixture/custom name'],
] as const) test(name,()=>assert.deepEqual(resolveProfileRoot({home:'/fixture/home',override}),{directory}));
for(const override of ['relative/profiles','   ','~/bad\npath','/bad\u0000path','~other/profiles'])test('rejects invalid root '+JSON.stringify(override),()=>{const result=resolveProfileRoot({home:'/fixture/home',override});assert.equal(result.directory,undefined);assert.ok(result.warning);});
for(const account of ['agent','agent-muu','agent-rbx'])test('same home independent of account '+account, t=>{const old=process.env.PI_CODING_AGENT_DIR;process.env.PI_CODING_AGENT_DIR='/fixture/'+account;t.after(()=>{if(old===undefined)delete process.env.PI_CODING_AGENT_DIR;else process.env.PI_CODING_AGENT_DIR=old;});assert.equal(resolveProfileRoot({home:'/fixture/home'}).directory,'/fixture/home/.pi/agent/profiles');});
