import test from 'node:test';
import assert from 'node:assert/strict';
import {plainPiLaunch,CHILD_LAUNCH_BLOCK_REASON} from '../../src/child-launch-guard.ts';
import guard from '../../extensions/child-launch-guard/index.ts';

const blocked=['herdr agent start x --kind pi --pane w1:p2','herdr agent start x --pane w1:p2 --kind=pi','herdr pane run w1:p2 pi',"herdr pane run w1:p2 'pi --session /a/b.jsonl'",'herdr --session Github pane run w1:p2 "pi"',"cd /x && herdr pane run w1:p2 'pi'"];
const allowed=['herdr agent start x --kind claude --pane w1:p2',"herdr pane run w1:p2 'pi-profile spawn --pane w1:p3'","herdr pane run w1:p2 'pi-profile launch --profile developer'","herdr pane run w1:p2 'pi-account muu'",'herdr pane read w1:p2',"herdr agent prompt pi 'hello'",'echo "herdr pane run x pi"','pi --version'];
test('plainPiLaunch detects plain pi launches through herdr',()=>{
  for(const c of blocked)assert.equal(plainPiLaunch(c),true,c);
  for(const c of allowed)assert.equal(plainPiLaunch(c),false,c);
});
function handler(){
  let h:any;
  guard({on:(n:string,f:unknown)=>{if(n==='tool_call')h=f;}} as any);
  return h as (e:unknown,c:unknown)=>Promise<unknown>;
}
test('extension blocks plain pi launches from bash only',async()=>{
  const h=handler();
  const cmd='herdr pane run w1:p2 pi';
  assert.deepEqual(await h({toolName:'bash',input:{command:cmd}},{}),{block:true,reason:CHILD_LAUNCH_BLOCK_REASON});
  assert.equal(await h({toolName:'read',input:{command:cmd}},{}),undefined);
  assert.equal(await h({toolName:'bash',input:{command:'ls'}},{}),undefined);
  process.env.PI_SUBAGENT_CHILD='1';
  try{assert.equal(await h({toolName:'bash',input:{command:cmd}},{}),undefined);}
  finally{delete process.env.PI_SUBAGENT_CHILD;}
});
