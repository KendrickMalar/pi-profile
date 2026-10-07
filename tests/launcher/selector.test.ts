import test from 'node:test';import assert from 'node:assert/strict';import {existsSync} from 'node:fs';
async function api(){const u=new URL('../../src/select-profile.ts',import.meta.url);assert.ok(existsSync(u),'profile selector not implemented');return import(u.href);}
const profiles=[{id:'standard',label:'Other',description:'',instructions:''},{id:'developer',label:'開発',description:'説明',instructions:'NEW'}];
test('saved snapshot wins over changed definition; incompatible override rejects without selecting',async()=>{
 const a=await api(),saved={version:1,id:'developer',label:'OLD',instructions:'FIXED'},target={kind:'resume',savedProfile:saved,cwd:'/',forwardedArgs:[]};
 let chosen=false;assert.equal((await a.selectStartupProfile(target,profiles,undefined,async()=>{chosen=true;return{kind:'selected',id:'standard'};})).instructions,'FIXED');assert.equal(chosen,false);
 await assert.rejects(()=>a.selectStartupProfile(target,profiles,'standard',async()=>({kind:'escape'})));
});
test('new choices use ID; Escape is Other, cancel is null, explicit ID needs no UI',async()=>{
 const a=await api(),target={kind:'new',cwd:'/',forwardedArgs:[]};
 assert.equal((await a.selectStartupProfile(target,profiles,undefined,async()=>({kind:'selected',id:'developer'}))).id,'developer');
 assert.equal((await a.selectStartupProfile(target,profiles,undefined,async()=>({kind:'escape'}))).id,'standard');
 assert.equal(await a.selectStartupProfile(target,profiles,undefined,async()=>({kind:'cancel'})),null);
 assert.equal((await a.selectStartupProfile(target,profiles,'developer',async()=>{throw new Error('no UI');})).id,'developer');
});
