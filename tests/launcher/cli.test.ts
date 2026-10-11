import test from 'node:test';import assert from 'node:assert/strict';import {existsSync,mkdtempSync,mkdirSync,writeFileSync,readFileSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';
async function api(){const u=new URL('../../src/cli.ts',import.meta.url);assert.ok(existsSync(u),'CLI not implemented');return import(u.href);}
test('version passthrough requires no selector/SDK/Profile and management changes only the selected declaration',async()=>{
 const a=await api(),d=mkdtempSync(join(tmpdir(),'profile-cli-')),pi=join(d,'pi'),log=join(d,'args');
 writeFileSync(pi,'#!/bin/sh\nprintf "%s\\n" "$@" > '+JSON.stringify(log)+'\n',{mode:0o755});
 assert.equal(await a.runCli(['launch','--','--version'],{HOME:d,PATH:process.env.PATH,PI_PROFILE_PI_BIN:pi}),0);assert.equal(readFileSync(log,'utf8'),'--version\n');
 const root=join(d,'profiles'),dev=join(root,'development');mkdirSync(dev,{recursive:true});writeFileSync(join(dev,'profile.json'),'{"id":"developer","label":"Development","description":""}');writeFileSync(join(dev,'instructions.md'),'UNCHANGED');
 const env={HOME:d,PATH:process.env.PATH,PI_PROFILE_DIR:root,PI_PROFILE_PI_BIN:'/opt/homebrew/bin/pi'};
 assert.equal(await a.runCli(['packages','add','--profile','developer','npm:probe@1.0.0'],env),0);
 assert.deepEqual(JSON.parse(readFileSync(join(dev,'packages.json'),'utf8')).packages,['npm:probe@1.0.0']);
 assert.equal(await a.runCli(['packages','remove','--profile','developer','npm:probe'],env),0);
 assert.equal(readFileSync(join(dev,'instructions.md'),'utf8'),'UNCHANGED');assert.equal(existsSync(join(d,'.pi/agent/settings.json')),false);
});

test('resume_menu_uses_legacy_chooser',async()=>{
 const a=await api(),d=mkdtempSync(join(tmpdir(),'profile-cli-resume-')),root=join(d,'node_modules','@earendil-works','pi-coding-agent'),dist=join(root,'dist'),tui=join(d,'node_modules','@earendil-works','pi-tui'),session=join(d,'session.jsonl');mkdirSync(dist,{recursive:true});mkdirSync(tui,{recursive:true});
 writeFileSync(join(root,'package.json'),JSON.stringify({name:'@earendil-works/pi-coding-agent',version:'1.0.4',type:'module',exports:{'.':{import:'./dist/index.js'}}}));
 writeFileSync(join(dist,'cli.js'),'#!/usr/bin/env node\n',{mode:0o755});
 writeFileSync(join(tui,'package.json'),JSON.stringify({name:'@earendil-works/pi-tui',version:'1.0.4',type:'module',main:'index.js'}));writeFileSync(join(tui,'index.js'),"export const truncateToWidth=(text,width)=>text.slice(0,width)\n");
 writeFileSync(session,JSON.stringify({type:'session',id:'session-1',cwd:process.cwd()})+'\n');
 writeFileSync(join(dist,'index.js'),`export class DefaultPackageManager {}\nexport class SettingsManager { static create(){return new this()} static inMemory(){return new this()} getGlobalSettings(){return {}} setProjectTrusted(){} }\nexport class SessionManager { static async list(){return [{id:'session-1',path:${JSON.stringify(session)},name:'Legacy session',firstMessage:'',modified:new Date()}]} static async listAll(){return this.list()} }\nexport function parseSessionEntries(raw){return raw.split('\\n').filter(Boolean).map(JSON.parse)}\n`);
 const input:any=process.stdin,output:any=process.stdout,saved={
  inputIsTTY:Object.getOwnPropertyDescriptor(input,'isTTY'),inputIsRaw:Object.getOwnPropertyDescriptor(input,'isRaw'),setRawMode:Object.getOwnPropertyDescriptor(input,'setRawMode'),resume:Object.getOwnPropertyDescriptor(input,'resume'),pause:Object.getOwnPropertyDescriptor(input,'pause'),
  outputIsTTY:Object.getOwnPropertyDescriptor(output,'isTTY'),columns:Object.getOwnPropertyDescriptor(output,'columns'),rows:Object.getOwnPropertyDescriptor(output,'rows'),write:Object.getOwnPropertyDescriptor(output,'write'),
 };
 let raw=false,text='';const set=(target:any,key:string,value:any)=>Object.defineProperty(target,key,{configurable:true,writable:true,value});
 const restore=(target:any,key:string,descriptor:PropertyDescriptor|undefined)=>descriptor?Object.defineProperty(target,key,descriptor):delete target[key];
 try{
  set(input,'isTTY',true);set(input,'isRaw',false);set(input,'setRawMode',(value:boolean)=>{raw=value;input.isRaw=value;return input});set(input,'resume',()=>input);set(input,'pause',()=>input);
  set(output,'isTTY',true);set(output,'columns',80);set(output,'rows',24);set(output,'write',(value:any)=>{text+=String(value);return true});
  const running=a.runCli(['launch','--','--resume'],{HOME:d,PATH:process.env.PATH,PI_PROFILE_PI_BIN:join(dist,'cli.js')});
  for(let retry=0;retry<100&&!text.includes('再開する会話');retry++)await new Promise(resolve=>setTimeout(resolve,5));
  assert.match(text,/再開する会話/);assert.match(text,/\[session-1\] Legacy session/);assert.doesNotMatch(text,/今日は何をしますか/);
  input.emit('data',Buffer.from('\x03'));
  await assert.rejects(running,/会話選択を中止しました/);assert.equal(raw,false);
 }finally{
  restore(input,'isTTY',saved.inputIsTTY);restore(input,'isRaw',saved.inputIsRaw);restore(input,'setRawMode',saved.setRawMode);restore(input,'resume',saved.resume);restore(input,'pause',saved.pause);
  restore(output,'isTTY',saved.outputIsTTY);restore(output,'columns',saved.columns);restore(output,'rows',saved.rows);restore(output,'write',saved.write);
 }
});
