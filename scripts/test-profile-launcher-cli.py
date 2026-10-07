#!/usr/bin/env python3
"""Built launcher acceptance: synthetic HOME, loopback model, no real accounts."""
import argparse, importlib.util, json, os, shutil, subprocess, sys, time, unittest
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location("profile_base",ROOT/"scripts/test-startup-profile-cli.py")
base=importlib.util.module_from_spec(spec);spec.loader.exec_module(base)
OPTIONS=None
class Launcher(base.Acceptance):
 def setUp(self):
  super().setUp();self.launch_options=[];self.discovery=False;self.model="profile-fixture/fixture"
  self.launcher=Path(OPTIONS.launcher).resolve()
  self.env['PI_PROFILE_PI_BIN']=OPTIONS.pi
 def args(self,*extra):
  args=[shutil.which("node"),str(self.launcher),"launch",*self.launch_options,"--","--offline","--no-skills","--no-prompt-templates","--model",self.model]
  if not self.discovery:args.append("--no-extensions")
  for extension in self.pre_extensions+self.extra_extensions:args+=["-e",str(extension)]
  return args+list(extra)
 def choose(self,c,index=2):
  c.wait(lambda:"起動するProfile" in c.text());self.assertEqual(len(self.requests),0)
  c.send("\x1b[B"*index+"\r")
  c.wait(lambda:"profile:"+["Research","Specification","Development","Chore（雑務）","Other"][index] in c.text())
 def test_new_fixed_reload_and_new(self):
  c=self.child();self.choose(c);self.assert_persona(self.prompt(c),"開発")
  for command in ("/reload","/new"):
   mark=len(c.data);c.send(command+"\r")
   c.wait(lambda:"profile:Development" in c.text(mark) or "Reloaded" in c.text(mark) or "reloaded" in c.text(mark) or "New session started" in c.text(mark))
   self.assertNotIn("起動するProfile",c.text(mark));self.assertNotIn("会話のprofileを選択",c.text(mark))
   self.assert_persona(self.prompt(c,"after "+command),"開発")
 def test_resume_continue_and_legacy(self):
  c=self.child();self.choose(c);self.prompt(c);path=self.session();c.close();self.children.remove(c)
  self.run_mode("--continue","--mode","json","continued");self.assert_persona(self.requests[-1],"開発")
  self.run_mode("--session",str(path),"--print","resumed");self.assert_persona(self.requests[-1],"開発")
 def test_noninteractive_and_piped_stdin(self):
  for args in [("--print","print"),("--mode","json","json")]:
   r=self.run_mode(*args);self.assert_persona(self.requests[-1],"標準");self.assertNotIn("起動するProfile",r.stdout)
  r=self.run_mode("--print",input="PIPED_INPUT_MARKER");self.assertIn("PIPED_INPUT_MARKER",json.dumps(self.requests[-1]))
 def test_profile_package_isolation(self):
  pkg=self.home/"owned-package";pkg.mkdir();marker=self.home/"pkg-loaded"
  (pkg/"package.json").write_text(json.dumps({"name":"owned-probe","version":"1.0.0","pi":{"extensions":["index.ts"]}}))
  (pkg/"index.ts").write_text("import {appendFileSync} from 'node:fs'; export default function(pi){appendFileSync("+json.dumps(str(marker))+",'loaded\\n');pi.registerTool({name:'owned_probe_tool',label:'Owned',description:'OWNED_TOOL',parameters:{type:'object',properties:{}},execute:async()=>({content:[{type:'text',text:'local'}],details:undefined})});}")
  (self.profiles/"development/packages.json").write_text(json.dumps({"version":1,"packages":[str(pkg)]}))
  self.launch_options=["--profile","developer"];self.run_mode("--print","developer package");self.assertTrue(marker.exists());self.assertIn("owned_probe_tool",json.dumps(self.requests[-1].get("tools",[])))
  before=marker.read_text();self.launch_options=["--profile","research"];self.run_mode("--print","research package")
  self.assertEqual(marker.read_text(),before);self.assertNotIn("owned_probe_tool",json.dumps(self.requests[-1].get("tools",[])))
 def test_project_trust(self):
  self.discovery=True;project=self.cwd/".pi/extensions";project.mkdir(parents=True);marker=self.home/"project-loaded"
  (project/"probe.ts").write_text("import {writeFileSync} from 'node:fs';export default function(){writeFileSync("+json.dumps(str(marker))+",'yes');}")
  self.launch_options=["--profile","developer"];self.run_mode("--no-approve","--print","untrusted");self.assertFalse(marker.exists())
  self.run_mode("--approve","--print","trusted");self.assertTrue(marker.exists())
 def test_three_account_dirs(self):
  for name in ("kuno","muu","rbx"):
   target=self.home/("agent-"+name);target.mkdir()
   for file in ("auth.json","models.json","settings.json"):shutil.copyfile(self.agent/file,target/file)
   models=json.loads((target/"models.json").read_text());models["providers"]["profile-fixture"]["models"][0]["id"]="fixture-"+name
   (target/"models.json").write_text(json.dumps(models));before={f:(target/f).read_bytes() for f in ("auth.json","models.json","settings.json")}
   old=self.env["PI_CODING_AGENT_DIR"];self.env["PI_CODING_AGENT_DIR"]=str(target);self.model="profile-fixture/fixture-"+name;self.launch_options=["--profile","developer"]
   try:self.run_mode("--print","account "+name);self.assertEqual(self.requests[-1]["model"],"fixture-"+name)
   finally:self.env["PI_CODING_AGENT_DIR"]=old
   for f,data in before.items():self.assertEqual((target/f).read_bytes(),data)
 def test_escape_cancel_resize(self):
  c=self.child();c.wait(lambda:"起動するProfile" in c.text());c.send("\x1b");c.wait(lambda:"profile:Other" in c.text());self.assert_persona(self.prompt(c),"標準");c.close();self.children.remove(c)
  c=self.child();c.wait(lambda:"起動するProfile" in c.text());c.send("\x03");c.wait(lambda:c.p.poll() is not None);self.assertEqual(len(self.requests),1)

 def test_resize_and_sigterm(self):
  import fcntl,termios,struct,signal
  c=self.child();c.wait(lambda:'起動するProfile' in c.text())
  fcntl.ioctl(c.master,termios.TIOCSWINSZ,struct.pack('HHHH',16,40,0,0));os.kill(c.p.pid,signal.SIGWINCH);c.pump(.1)
  self.choose(c);self.assert_persona(self.prompt(c),'開発')
  os.kill(c.p.pid,signal.SIGTERM);c.wait(lambda:c.p.poll() is not None)
  self.assertNotIn('会話のprofileを選択',c.text())
 def test_fork_and_no_session(self):
  c=self.child();self.choose(c);self.prompt(c);path=self.session();c.close();self.children.remove(c)
  self.run_mode("--fork",str(path),"--print","forked");self.assert_persona(self.requests[-1],"開発")
  self.launch_options=["--profile","developer"];self.run_mode("--no-session","--print","ephemeral");self.assert_persona(self.requests[-1],"開発")
 def test_no_offline_added(self):
  self.launch_options=["--profile","developer"];env=dict(self.env);env.pop("PI_OFFLINE",None)
  args=self.args("--print","explicit question");args.remove("--offline")
  r=subprocess.run(args,env=env,cwd=self.cwd,text=True,capture_output=True,timeout=15)
  self.assertEqual(r.returncode,0,r.stderr);self.assert_persona(self.requests[-1],"開発")
  # Product has no offline override; catalog refresh itself is separately covered by argv/env test.

 def test_rpc_and_cross_profile_switch(self):
  import select
  self.launch_options=['--profile','developer'];p=subprocess.Popen(self.args('--mode','rpc'),env=self.env,cwd=self.cwd,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
  events=[];pending=b'';counter=0
  def pump_until(predicate):
   nonlocal pending
   deadline=time.monotonic()+15
   while not predicate():
    if time.monotonic()>deadline:raise AssertionError('RPC timeout '+str(events[-5:]))
    if select.select([p.stdout],[],[],.1)[0]:
     chunk=os.read(p.stdout.fileno(),65536)
     if not chunk:raise AssertionError('RPC exited')
     pending+=chunk
     while b'\n' in pending:
      line,pending=pending.split(b'\n',1)
      if line:events.append(json.loads(line))
  def command(kind,**data):
   nonlocal counter
   counter+=1;id=str(counter);p.stdin.write((json.dumps({'id':id,'type':kind,**data})+'\n').encode());p.stdin.flush()
   pump_until(lambda:any(e.get('type')=='response' and e.get('id')==id for e in events))
   return next(e for e in events if e.get('type')=='response' and e.get('id')==id)
  try:
   command('prompt',message='RPC_PROFILE_MARKER');pump_until(lambda:any(e.get('type')=='agent_end' for e in events));self.assert_persona(self.requests[-1],'開発')
   original=command('get_state')['data']['sessionId']
   target=self.home/'research.jsonl';target.write_text('\n'.join(json.dumps(e) for e in [{'type':'session','version':3,'id':'research-id','timestamp':'2026-10-07T00:00:00Z','cwd':str(self.cwd)},{'type':'custom','id':'profile','parentId':None,'timestamp':'2026-10-07T00:00:01Z','customType':'startup-profile-state','data':{'version':1,'id':'research','label':'Research','instructions':'R'}}])+'\n')
   switched=command('switch_session',sessionPath=str(target));self.assertTrue(switched['data']['cancelled']);self.assertEqual(command('get_state')['data']['sessionId'],original)
  finally:
   p.stdin.close();p.stdin=None
   try:p.communicate(timeout=3)
   except subprocess.TimeoutExpired:p.terminate();p.communicate(timeout=3)

 def test_noisy_acquisition_keeps_json_and_stdin(self):
  fake=self.home/'npm.mjs';capture=self.home/'installer-input'
  fake.write_text("import fs from 'node:fs';import path from 'node:path';const a=process.argv.slice(2);if(a[0]==='root'){console.log("+json.dumps(str(self.home/'no-global'))+");}else{fs.writeFileSync("+json.dumps(str(capture))+",fs.readFileSync(0,'utf8'));console.log('INSTALLER_STDOUT_NOISE');console.error('INSTALLER_STDERR_NOISE');const p=a[a.indexOf('--prefix')+1],d=path.join(p,'node_modules','noisy-profile');fs.mkdirSync(d,{recursive:true});fs.writeFileSync(path.join(d,'package.json'),JSON.stringify({name:'noisy-profile',version:'1.0.0',pi:{extensions:['index.ts']}}));fs.writeFileSync(path.join(d,'index.ts'),'export default function(){}');}")
  settings=json.loads((self.agent/'settings.json').read_text());settings['npmCommand']=[shutil.which('node'),str(fake)];(self.agent/'settings.json').write_text(json.dumps(settings));self.unchanged['settings.json']=(self.agent/'settings.json').read_bytes()
  (self.profiles/'development/packages.json').write_text(json.dumps({'version':1,'packages':['npm:noisy-profile@1.0.0']}))
  self.launch_options=['--profile','developer'];env=dict(self.env);env.pop('PI_OFFLINE',None);args=self.args('--mode','json');args.remove('--offline')
  result=subprocess.run(args,env=env,cwd=self.cwd,input='PIPE_MUST_REACH_PI',text=True,capture_output=True,timeout=15)
  self.assertEqual(result.returncode,0,result.stderr)
  self.assertEqual(capture.read_text(),'','installer must not consume prompt input')
  self.assertIn('INSTALLER_STDOUT_NOISE',result.stderr)
  for line in result.stdout.splitlines():
   if line:json.loads(line)
  self.assertIn('PIPE_MUST_REACH_PI',json.dumps(self.requests[-1]))
 def test_profile_subagents(self):
  if not OPTIONS.subagents_extension:self.skipTest("explicit installed subagents path required")
  self.subagent_resources(fixed_profile=True)
if __name__=="__main__":
 parser=argparse.ArgumentParser();parser.add_argument("--pi",default=shutil.which("pi"));parser.add_argument("--launcher",required=True);parser.add_argument("--case")
 for name in ("subagents-extension","plan-extension","omp-extension"):parser.add_argument("--"+name)
 OPTIONS=parser.parse_args()
 if not OPTIONS.pi or not Path(OPTIONS.launcher).is_file():parser.error("Pi and existing built launcher are required")
 for name in ("subagents_extension","plan_extension","omp_extension"):
  value=getattr(OPTIONS,name)
  if value and not Path(value).is_file():parser.error("explicit extension path does not exist")
 base.OPTIONS=argparse.Namespace(pi=OPTIONS.pi,without_extension=False,compatibility_only=False,subagents_extension=OPTIONS.subagents_extension,plan_extension=OPTIONS.plan_extension,omp_extension=OPTIONS.omp_extension)
 base.ARTIFACTS=ROOT/".test-evidence/launcher"
 names=["test_"+OPTIONS.case] if OPTIONS.case else [n for n in Launcher.__dict__ if n.startswith("test_")]
 if any(n not in Launcher.__dict__ for n in names):parser.error("unknown case")
 suite=unittest.TestSuite(Launcher(n) for n in names)
 result=unittest.TextTestRunner(verbosity=2).run(suite);raise SystemExit(0 if result.wasSuccessful() else 1)
