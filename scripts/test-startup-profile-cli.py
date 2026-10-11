#!/usr/bin/env python3
"""Real Pi acceptance tests: disposable HOME, loopback-only model, PTY evidence."""
import argparse
import codecs
import hashlib
import http.server
import json
import os
from pathlib import Path
import pty
import re
import select
import shutil
import signal
import struct
import subprocess
import tempfile
import termios
import threading
import time
import unittest
import unicodedata
import fcntl

ROOT = Path(__file__).resolve().parents[1]
ARTIFACTS = ROOT / ".test-evidence/cli"
OPTIONS = None
ANSI = re.compile(r"\x1b(?:\[[0-?]*[ -/]*[@-~]|\][^\x07]*(?:\x07|\x1b\\)|[()][A-Z0-9])")
GUIDED_TITLE = "◆ 今日は何をしますか？"
SHORT_GUIDED_TITLE = "◆ Profile"
LEGACY_TITLES = ("会話のprofileを選択", "起動するProfile")


def cell_width(char):
    if unicodedata.combining(char) or char in ("\ufe0e", "\ufe0f", "\u200d"):
        return 0
    return 2 if unicodedata.east_asian_width(char) in ("W", "F") else 1


class TerminalScreen:
    """Small VT screen model for selector assertions; applies cursor movement and erasure."""
    def __init__(self, rows, columns):
        self.decoder = codecs.getincrementaldecoder("utf8")("replace")
        self.rows = max(1, rows); self.columns = max(1, columns)
        self.cells = [[" "] * self.columns for _ in range(self.rows)]
        self.row = 0; self.column = 0; self.mode = "text"; self.sequence = ""
        self.auto_wraps = 0; self.scrolls = 0

    def resize(self, rows, columns):
        rows=max(1,rows);columns=max(1,columns)
        next_cells=[[" "]*columns for _ in range(rows)]
        for y in range(min(rows,self.rows)):
            for x in range(min(columns,self.columns)):
                next_cells[y][x]=self.cells[y][x]
        self.rows=rows;self.columns=columns;self.cells=next_cells
        self.row=min(self.row,rows-1);self.column=min(self.column,columns-1)

    def feed(self, data):
        for char in self.decoder.decode(data):
            if self.mode == "text":
                if char == "\x1b": self.mode="escape";self.sequence=""
                elif char == "\r": self.column=0
                elif char in ("\n", "\x0b", "\x0c"): self._linefeed()
                elif char == "\b": self.column=max(0,self.column-1)
                elif char == "\t": self.column=min(self.columns-1,((self.column//8)+1)*8)
                elif ord(char) >= 32 and char != "\x7f": self._put(char)
            elif self.mode == "escape":
                if char == "[": self.mode="csi";self.sequence=""
                elif char == "]": self.mode="osc";self.sequence=""
                elif char in "()#": self.mode="escape-one"
                elif char == "7": self.mode="text"
                elif char == "8": self.mode="text"
                else: self.mode="text"
            elif self.mode == "escape-one":
                self.mode="text"
            elif self.mode == "osc":
                if char == "\x07": self.mode="text"
                elif char == "\x1b": self.mode="osc-escape"
            elif self.mode == "osc-escape":
                self.mode="text" if char == "\\" else "osc"
            elif self.mode == "csi":
                self.sequence += char
                if "@" <= char <= "~":
                    self._csi(self.sequence);self.mode="text";self.sequence=""

    def _linefeed(self):
        if self.row == self.rows - 1:
            self.scrolls += 1
            self.cells.pop(0);self.cells.append([" "]*self.columns)
        else:self.row += 1

    def _put(self, char):
        width=cell_width(char)
        if width == 0:
            if self.column > 0:self.cells[self.row][self.column-1] += char
            return
        if self.column >= self.columns:
            self.auto_wraps += 1;self.column=0;self._linefeed()
        if width == 2 and self.column == self.columns-1:
            self.auto_wraps += 1;self.column=0;self._linefeed()
        self.cells[self.row][self.column]=char
        if width == 2 and self.column+1 < self.columns:self.cells[self.row][self.column+1]=""
        self.column += width

    def _csi(self, sequence):
        final=sequence[-1];raw=sequence[:-1]
        private=raw.startswith("?")
        if private:raw=raw[1:]
        values=[]
        for value in raw.split(";") if raw else []:
            try:values.append(int(value) if value else 0)
            except ValueError:values.append(0)
        amount=(values[0] if values and values[0] else 1)
        if final == "A":self.row=max(0,self.row-amount)
        elif final == "B":self.row=min(self.rows-1,self.row+amount)
        elif final == "C":self.column=min(self.columns-1,self.column+amount)
        elif final == "D":self.column=max(0,self.column-amount)
        elif final == "E":self.row=min(self.rows-1,self.row+amount);self.column=0
        elif final == "F":self.row=max(0,self.row-amount);self.column=0
        elif final == "G":self.column=min(self.columns-1,max(0,amount-1))
        elif final in ("H","f"):
            self.row=min(self.rows-1,max(0,(values[0] if values and values[0] else 1)-1))
            self.column=min(self.columns-1,max(0,(values[1] if len(values)>1 and values[1] else 1)-1))
        elif final == "J":
            mode=values[0] if values else 0
            if mode in (2,3):self.cells=[[" "]*self.columns for _ in range(self.rows)]
            elif mode == 0:
                self.cells[self.row][self.column:]=[" "]*(self.columns-self.column)
                for row in range(self.row+1,self.rows):self.cells[row]=[" "]*self.columns
            elif mode == 1:
                for row in range(self.row):self.cells[row]=[" "]*self.columns
                self.cells[self.row][:self.column+1]=[" "]*(self.column+1)
        elif final == "K":
            mode=values[0] if values else 0
            if mode == 0:self.cells[self.row][self.column:]=[" "]*(self.columns-self.column)
            elif mode == 1:self.cells[self.row][:self.column+1]=[" "]*(self.column+1)
            elif mode == 2:self.cells[self.row]=[" "]*self.columns

    def reset_activity(self):
        self.auto_wraps=0;self.scrolls=0

    def activity(self):
        return {"auto_wraps":self.auto_wraps,"scrolls":self.scrolls}

    def lines(self):
        return ["".join(row).rstrip() for row in self.cells]

    def text(self):
        return "\n".join(self.lines())

class Child:
    def __init__(self, args, env, cwd, rows=42, columns=120):
        self.master, slave = pty.openpty()
        os.set_blocking(self.master, False)
        self.rows=rows; self.columns=columns; self.screen=TerminalScreen(rows,columns)
        fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack("HHHH", rows, columns, 0, 0))
        self.p = subprocess.Popen(args, stdin=slave, stdout=slave, stderr=slave,
                                  env=env, cwd=cwd, start_new_session=True)
        os.close(slave)
        self.data = b""
        self.closed = False
    def pump(self, seconds=.05):
        if select.select([self.master], [], [], seconds)[0]:
            try:
                b = os.read(self.master, 65536)
                self.data += b
                self.screen.feed(b)
                # Answer terminal queries using fixture values only.
                if b"\x1b[6n" in b: self.send(b"\x1b[1;1R")
                if b"\x1b[c" in b: self.send(b"\x1b[?1;2c")
            except OSError: pass
    def text(self, mark=0):
        return ANSI.sub("", self.data[mark:].decode("utf8", "replace"))
    def screen_text(self):
        return self.screen.text()
    def screen_contains(self, text):
        return any(text in line for line in self.screen.lines())
    def resize(self, rows, columns):
        self.rows=rows;self.columns=columns;self.screen.resize(rows,columns)
        fcntl.ioctl(self.master,termios.TIOCSWINSZ,struct.pack("HHHH",rows,columns,0,0))
        os.kill(self.p.pid,signal.SIGWINCH)
    def wait(self, predicate, timeout=12):
        end = time.monotonic() + timeout
        while time.monotonic() < end:
            self.pump()
            if predicate(): return
            if self.p.poll() is not None: break
        raise AssertionError("timeout/exit waiting for Pi; tail:\n"+self.text()[-4000:])
    def send(self, data):
        payload = data.encode() if isinstance(data, str) else data
        deadline = time.monotonic()+12
        offset = 0
        while offset < len(payload):
            if time.monotonic() > deadline: raise AssertionError("PTY input blocked")
            self.pump(0)
            if select.select([], [self.master], [], .05)[1]:
                try: offset += os.write(self.master, payload[offset:offset+512])
                except BlockingIOError: pass
    def close(self):
        if self.closed: return
        self.closed = True
        if self.p.poll() is None:
            os.killpg(self.p.pid, signal.SIGTERM)
            try: self.p.wait(timeout=3)
            except subprocess.TimeoutExpired:
                os.killpg(self.p.pid, signal.SIGKILL); self.p.wait(timeout=3)
        self.pump(0)
        os.close(self.master)

class Acceptance(unittest.TestCase):
    def setUp(self):
        self.maxDiff = None
        self.tmp = tempfile.TemporaryDirectory(prefix="pi-profile-fixture-")
        self.home = Path(self.tmp.name)
        self.agent = self.home / "agent"; self.agent.mkdir()
        self.cwd = self.home / "cwd"; self.cwd.mkdir()
        self.package = self.home / "package"
        self.extension = self.package / "extensions/startup-profile"
        shutil.copytree(ROOT/"extensions/startup-profile", self.extension)
        shutil.copyfile(ROOT/"package.json", self.package/"package.json")
        for dependency in ('src', 'dist'):
            if (ROOT/dependency).is_dir(): shutil.copytree(ROOT/dependency, self.package/dependency)
        self.profiles = self.home / '.pi/agent/profiles'
        self.profiles.parent.mkdir(parents=True)
        shutil.copytree(self.extension/'profiles', self.profiles)
        self.load_as_package = False
        self.extra_extensions = []
        self.resource_mode = False
        self.pre_extensions = []
        self.requests = []; self.children = []
        requests = self.requests
        owner = self
        self.fail_requests = False
        class Handler(http.server.BaseHTTPRequestHandler):
            def log_message(self, *_): pass
            def do_POST(self):
                body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
                requests.append(body)
                if owner.fail_requests:
                    self.send_response(400); self.send_header("Content-Type","application/json"); self.end_headers()
                    self.wfile.write(b'{"error":{"message":"fixture failure"}}'); return
                self.send_response(200); self.send_header("Content-Type", "text/event-stream")
                self.end_headers()
                messages=body.get('messages',[])
                users=[(i,m) for i,m in enumerate(messages) if m.get('role')=='user']
                probe=users[-1] if users else None
                content=probe[1].get('content','') if probe else ''
                command=''.join(p.get('text','') for p in content if isinstance(p,dict)) if isinstance(content,list) else str(content)
                trailing=messages[probe[0]+1:] if probe else []
                if command.startswith('RUN_AGENT:') and not trailing:
                    _,agent,mode=command.split(':')
                    call={'index':0,'id':'fixture-call','type':'function','function':{'name':'subagent','arguments':json.dumps({'agent':agent,'task':'CHILD_TASK','async':mode=='background','artifacts':False,'timeoutMs':20000,'acceptance':{'level':'none','reason':'loopback fixture'}})}}
                    chunk={'id':'fixture','object':'chat.completion.chunk','created':1,'model':'fixture','choices':[{'index':0,'delta':{'role':'assistant','tool_calls':[call]},'finish_reason':None}]}
                    self.wfile.write(('data: '+json.dumps(chunk)+'\n\n').encode())
                    chunk['choices']=[{'index':0,'delta':{},'finish_reason':'tool_calls'}]
                    self.wfile.write(('data: '+json.dumps(chunk)+'\n\ndata: [DONE]\n\n').encode());self.wfile.flush();return
                for delta, finish in [({"role":"assistant","content":"FIXTURE_OK"},None), ({}, "stop")]:
                    chunk={"id":"fixture","object":"chat.completion.chunk","created":1,"model":"fixture",
                           "choices":[{"index":0,"delta":delta,"finish_reason":finish}]}
                    self.wfile.write(("data: "+json.dumps(chunk)+"\n\n").encode())
                self.wfile.write(b"data: [DONE]\n\n"); self.wfile.flush()
        self.server = http.server.ThreadingHTTPServer(("127.0.0.1",0),Handler)
        self.thread = threading.Thread(target=self.server.serve_forever,daemon=True); self.thread.start()
        model={"providers":{"profile-fixture":{"baseUrl":f"http://127.0.0.1:{self.server.server_port}/v1",
                  "api":"openai-completions","apiKey":"FAKE_LOCAL_KEY","models":[{"id":"fixture","contextWindow":32768,"maxTokens":256}]}}}
        (self.agent/"models.json").write_text(json.dumps(model))
        (self.agent/"auth.json").write_text("{}")
        (self.agent/"settings.json").write_text(json.dumps({"quietStartup":True,"telemetry":False,"packages":[],"extensions":[],"compaction":{"enabled":True,"reserveTokens":1024,"keepRecentTokens":128}}))
        (self.agent/"AGENTS.md").write_text("COMMON_FIXTURE_RULE: no external services.")
        (self.cwd/"AGENTS.md").write_text("PROJECT_FIXTURE_RULE: preserve project instructions.")
        binpath=self.home/"bin";binpath.mkdir()
        # Existing executables are reused; never download tools or load real config.
        for name in ("node","fd","rg"):
            found=shutil.which(name)
            if found: (binpath/name).symlink_to(found)
        self.env={"HOME":str(self.home),"PATH":str(binpath)+":/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin",
                  "TERM":"xterm-256color","LANG":"en_US.UTF-8","PI_CODING_AGENT_DIR":str(self.agent),
                  "PI_CODING_AGENT_SESSION_DIR":str(self.agent/"sessions"),
                  "PI_OFFLINE":"1","PI_SKIP_VERSION_CHECK":"1","PI_TELEMETRY":"0",
                  "XDG_CONFIG_HOME":str(self.home/"xdg-config"),"XDG_DATA_HOME":str(self.home/"xdg-data"),
                  "XDG_STATE_HOME":str(self.home/"xdg-state"),"XDG_CACHE_HOME":str(self.home/"xdg-cache")}
        # Pi itself records changelog acknowledgement at startup, unrelated to profiles.
        version = subprocess.check_output([OPTIONS.pi,"--no-extensions","--version"], env=self.env, cwd=self.cwd, text=True, timeout=5).strip()
        settings = json.loads((self.agent/"settings.json").read_text())
        settings["lastChangelogVersion"] = version
        (self.agent/"settings.json").write_text(json.dumps(settings))
        self.unchanged={n:(self.agent/n).read_bytes() for n in ("auth.json","models.json","settings.json")}
    def tearDown(self):
        ARTIFACTS.mkdir(parents=True,exist_ok=True)
        name=self.id().split(".")[-1]
        for i,c in enumerate(self.children):
            c.close(); (ARTIFACTS/f"{name}-{i}.pty.txt").write_text(c.text())
            (ARTIFACTS/f"{name}-{i}.pty.raw").write_bytes(c.data)
            (ARTIFACTS/f"{name}-{i}.screen.txt").write_text(c.screen_text())
        (ARTIFACTS/f"{name}-requests.json").write_text(json.dumps(self.requests,ensure_ascii=False,indent=2))
        for n,data in self.unchanged.items():
            self.assertEqual((self.agent/n).read_bytes(),data,n+" mutated")
        self.server.shutdown();self.server.server_close();self.thread.join()
        self.tmp.cleanup()
    def assert_no_selector_output(self, text):
        for title in (GUIDED_TITLE, SHORT_GUIDED_TITLE, *LEGACY_TITLES):
            self.assertNotIn(title, text)
    def save_screen(self, label, child):
        ARTIFACTS.mkdir(parents=True, exist_ok=True)
        (ARTIFACTS/f"{self.id().split('.')[-1]}-{label}.screen.txt").write_text(child.screen_text())
        (ARTIFACTS/f"{self.id().split('.')[-1]}-{label}.raw").write_bytes(child.data)
    def install_many_profiles(self, count=12):
        self.legacy_only()
        catalog=[]
        ids=["research","specification","developer","chore"]+[f"fixture-{i}" for i in range(count-5)]+["standard"]
        for index, profile_id in enumerate(ids):
            label="同じ候補" if index in (5,6) else ("Other" if profile_id=="standard" else f"候補{index+1:02d}")
            item={"id":profile_id,"label":label,"description":f"説明 {index+1:02d} 固定位置の確認", "order":index}
            if profile_id != "standard":
                filename=f"{profile_id}.md"; (self.profiles/filename).write_text(f"PROFILE_{index+1:02d}")
                item["instructionsFile"]=filename
            catalog.append(item)
        (self.profiles/"catalog.json").write_text(json.dumps(catalog,ensure_ascii=False))
        return catalog
    def selector_options(self, child):
        options=[]
        for row,line in enumerate(child.screen.lines()):
            match=re.match(r"^│  (● |  )(.+)$",line)
            if not match:continue
            label=re.sub(r" (?:🧭|📐|💻|🧹)$","",match.group(2)).rstrip()
            options.append((row,match.group(1)=="● ",label))
        return options
    def assert_selector_frame(self, child, expected_labels, selected_label):
        options=self.selector_options(child)
        self.assertEqual([label for _row,_selected,label in options],expected_labels,child.screen_text())
        self.assertEqual([label for _row,selected,label in options if selected],[selected_label])
        rows=[row for row,_selected,_label in options]
        self.assertEqual(rows,list(range(rows[0],rows[0]+len(rows))),child.screen_text())
        footer=next(index for index,line in enumerate(child.screen.lines()) if line.startswith("└  "))
        self.assertGreater(footer,rows[-1])
    def assert_no_terminal_overflow(self, child):
        self.assertEqual(child.screen.activity(),{"auto_wraps":0,"scrolls":0},child.screen_text())
    def sgr_before_text(self, child, text):
        encoded=text.encode()
        end=child.data.rfind(encoded)
        self.assertGreaterEqual(end,0,text)
        start=child.data.rfind(b"\x1b[2K",0,end)
        self.assertGreaterEqual(start,0,text)
        return set(re.findall(rb"\x1b\[[0-9;]*m",child.data[start:end]))
    def args(self,*extra):
        args=[OPTIONS.pi,"--offline","--no-extensions","--no-skills","--no-prompt-templates",
              "--model","profile-fixture/fixture"]
        for extension in self.pre_extensions:
            args += ['--extension',str(extension)]
        if not OPTIONS.without_extension:
            args += ["--extension",str(self.package if self.load_as_package else self.extension/"index.ts")]
        for extension in self.extra_extensions:
            args += ['--extension', str(extension)]
        return args+list(extra)
    def child(self,*extra,rows=42,columns=120):
        c=Child(self.args(*extra),self.env,self.cwd,rows,columns);self.children.append(c);return c
    def choose(self,c,index=2):
        c.wait(lambda:GUIDED_TITLE in c.text())
        self.assertEqual(len(self.requests),0)
        c.send("\x1b[B"*index+"\r")
        labels=["Research","Specification","Development","Chore（雑務）","Other"]
        c.wait(lambda:"profile:"+labels[index] in c.text())
    def prompt(self,c,text="fixture prompt"):
        start=len(self.requests); mark=len(c.data)
        def assistants():
            return sum(1 for p in (self.agent/"sessions").rglob("*.jsonl") for e in self.entries(p) if e.get("type")=="message" and e["message"]["role"]=="assistant")
        before = assistants()
        c.send(("\x1b[200~"+text+"\x1b[201~\r") if len(text)>1000 else text+"\r")
        c.wait(lambda:len(self.requests)>start and (assistants()>before or "FIXTURE_OK" in c.text(mark)))
        return self.requests[-1]
    def entries(self,path):
        return [json.loads(x) for x in path.read_text().splitlines()]
    def session(self):
        paths=list((self.agent/"sessions").rglob("*.jsonl"));self.assertEqual(len(paths),1);return paths[0]
    def assert_persona(self,body,expected):
        text=json.dumps(body,ensure_ascii=False)
        self.assertIn("COMMON_FIXTURE_RULE",text);self.assertIn("PROJECT_FIXTURE_RULE",text)
        for label in ["仕様","開発","調査","雑務"]:
            self.assertEqual("# "+label+"profile" in text,label==expected)
    def run_mode(self,*extra,input=None):
        r=subprocess.run(self.args(*extra),env=self.env,cwd=self.cwd,input=input,
                         text=True,capture_output=True,timeout=15)
        self.assertEqual(r.returncode,0,r.stderr+"\n"+r.stdout[-3000:])
        return r
    def test_startup_select(self):
        c=self.child();self.choose(c);body=self.prompt(c);self.assert_persona(body,"開発")
        entries=self.entries(self.session())
        state=next(i for i,e in enumerate(entries) if e.get("customType")=="startup-profile-state")
        user=next(i for i,e in enumerate(entries) if e.get("type")=="message" and e["message"]["role"]=="user")
        self.assertLess(state,user)
    def test_chore(self):
        c=self.child();self.choose(c,3);self.assert_persona(self.prompt(c),"雑務")
    def test_other(self):
        c=self.child();self.choose(c,4);self.assert_persona(self.prompt(c),"Other")
    def test_specification(self):
        c=self.child();self.choose(c,1);self.assert_persona(self.prompt(c),"仕様")
    def test_research(self):
        c=self.child();self.choose(c,0);self.assert_persona(self.prompt(c),"調査")
    def test_cancel_no_session_file(self):
        c=self.child();c.wait(lambda:GUIDED_TITLE in c.text());c.send("\x1b")
        c.wait(lambda:"profile:Other" in c.text())
        self.assertFalse(list((self.agent/"sessions").rglob("*.jsonl")))
        self.assert_persona(self.prompt(c),"標準")
    def test_initial_prompt_waits_for_selection(self):
        c=self.child("initial fixture prompt");self.choose(c)
        c.wait(lambda:len(self.requests)>0 and "FIXTURE_OK" in c.text());self.assert_persona(self.requests[-1],"開発")
    def test_resume_immutable_without_files(self):
        c=self.child();self.choose(c);self.prompt(c);path=self.session();c.close()
        shutil.rmtree(self.profiles)
        r=self.run_mode("--session",str(path),"--print","resume fixture")
        self.assertIn("FIXTURE_OK",r.stdout);self.assert_persona(self.requests[-1],"開発")
    def test_continue_json_restores(self):
        c=self.child();self.choose(c,0);self.prompt(c);c.close()
        self.run_mode("--continue","--mode","json","continue fixture");self.assert_persona(self.requests[-1],"調査")
    def test_noninteractive_standard_and_rpc(self):
        for args in [("--print","print fixture"),("--mode","json","json fixture")]:
            self.run_mode(*args);self.assert_persona(self.requests[-1],"標準")
        p=subprocess.Popen(self.args("--mode","rpc"),env=self.env,cwd=self.cwd,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
        try:
            p.stdin.write(b'{"id":"one","type":"prompt","message":"rpc fixture"}\n');p.stdin.flush()
            events=[];deadline=time.monotonic()+15
            while time.monotonic()<deadline:
                if select.select([p.stdout],[],[],.1)[0]:
                    line=p.stdout.readline()
                    if not line: break
                    events.append(json.loads(line))
                    if events[-1].get("type")=="agent_end": break
            self.assertTrue(any(e.get("type")=="agent_end" for e in events),events)
            self.assertFalse(any(e.get("type")=="extension_ui_request" and e.get("method") in ("select","confirm","input","editor") for e in events), [(e.get("type"),e.get("method")) for e in events])
            self.assert_persona(self.requests[-1],"標準")
        finally:
            p.stdin.close();p.stdin=None
            try: p.communicate(timeout=3)
            except subprocess.TimeoutExpired: p.kill();p.communicate()
    def test_ephemeral_session(self):
        c=self.child("--no-session");self.choose(c);self.assert_persona(self.prompt(c),"開発")
        self.assertFalse(list((self.agent/"sessions").rglob("*.jsonl")))
    def test_reload_and_new(self):
        c=self.child();self.choose(c);self.prompt(c)
        mark=len(c.data);c.send("/reload\r")
        c.wait(lambda:"Reloaded" in c.text(mark) or "reloaded" in c.text(mark))
        self.assert_no_selector_output(c.text(mark))
        self.assert_persona(self.prompt(c,"after reload"),"開発")
        mark=len(c.data);c.send("/new\r")
        c.wait(lambda:GUIDED_TITLE in c.text(mark))
        c.send("\x1b");c.wait(lambda:"profile:Other" in c.text(mark))
        self.assert_persona(self.prompt(c,"after new"),"標準")
    def test_fork_and_legacy(self):
        c=self.child();self.choose(c);self.prompt(c);path=self.session();c.close()
        self.run_mode("--fork",str(path),"--print","fork fixture");self.assert_persona(self.requests[-1],"開発")
        # Remove only test-owned state to simulate a pre-feature conversation.
        legacy=self.agent/"legacy.jsonl"
        legacy.write_text("\n".join(json.dumps(e) for e in self.entries(path) if e.get("customType")!="startup-profile-state" and not (e.get("type")=="message" and e["message"]["role"]=="system"))+"\n")
        self.run_mode("--session",str(legacy),"--print","legacy fixture")
        self.assert_persona(self.requests[-1],"標準")

    def test_first_response_error_still_saves_choice(self):
        c=self.child();self.choose(c);self.fail_requests=True
        mark=len(c.data);c.send("failing fixture\r")
        c.wait(lambda:"fixture failure" in c.text(mark))
        entries=self.entries(self.session())
        self.assertTrue(any(e.get("customType")=="startup-profile-state" for e in entries))
        self.assertTrue(any(e.get("type")=="message" and e["message"]["role"]=="user" for e in entries))

    def test_clone_keeps_profile_without_selector(self):
        c=self.child();self.choose(c,0);self.prompt(c)
        mark=len(c.data);c.send("/clone\r");c.wait(lambda:"Cloned to new session" in c.text(mark))
        self.assert_no_selector_output(c.text(mark))
        self.assert_persona(self.prompt(c,"after clone"),"調査")

    def test_tree_and_compaction_keep_profile(self):
        helper=self.home/"fixture-tree.ts"
        helper.write_text('export default function(pi){pi.registerCommand("fixture-tree",{handler:async(_,ctx)=>{const e=ctx.sessionManager.getEntries().find(e=>e.type==="message"&&e.message.role==="user");await ctx.navigateTree(e.id,{summarize:false});ctx.ui.setEditorText("");ctx.ui.notify("TREE_FIXTURE_OK","info");}});}')
        c=self.child("--extension",str(helper));self.choose(c);self.prompt(c);self.prompt(c,"second fixture")
        mark=len(c.data);c.send("/fixture-tree\r");c.wait(lambda:"TREE_FIXTURE_OK" in c.text(mark))
        self.assert_persona(self.prompt(c,"after tree " + "fixture word "*800),"開発")
        self.prompt(c,"retained turn " + "fixture tail "*800)
        mark=len(c.data);c.send("/compact\r")
        c.wait(lambda:any(e.get("type")=="compaction" for e in self.entries(self.session())))
        self.assert_persona(self.prompt(c,"after compaction"),"開発")

    def test_real_plan_and_omp_modes(self):
        if not (OPTIONS.plan_extension and OPTIONS.omp_extension):
            self.skipTest("external compatibility not requested; pass both extension paths")
        plan=Path(OPTIONS.plan_extension)
        self.assertTrue(plan.is_file(),"Pass --plan-extension to the installed plan-mode.ts")
        # Explicitly load known extensions into synthetic HOME, never their user config.
        args=["--extension",str(plan),"--extension",str(Path(OPTIONS.omp_extension))]
        c=self.child(*args);self.choose(c)
        mark=len(c.data);c.send("/plan\r");c.wait(lambda:"Plan mode" in c.text(mark) or "plan mode" in c.text(mark))
        body=self.prompt(c,"plan fixture");self.assert_persona(body,"開発")
        text=json.dumps(body,ensure_ascii=False)
        self.assertIn("[PLAN MODE ACTIVE]",text)
        names=[t["function"]["name"] for t in body.get("tools",[])]
        self.assertNotIn("write",names)
        mark=len(c.data);c.send("/reload\r")
        c.wait(lambda:"Reloaded" in c.text(mark) or "reloaded" in c.text(mark))
        self.assert_no_selector_output(c.text(mark))
        body=self.prompt(c,"plan after reload");self.assert_persona(body,"開発")
        self.assertIn("[PLAN MODE ACTIVE]",json.dumps(body,ensure_ascii=False))
        self.assertNotIn("write",[t["function"]["name"] for t in body.get("tools",[])])
        mark=len(c.data);c.send("/plan\r");c.wait(lambda:"Plan mode" in c.text(mark) or "plan mode" in c.text(mark))
        body=self.prompt(c,"normal fixture");self.assert_persona(body,"開発")
        self.assertIn("write",[t["function"]["name"] for t in body.get("tools",[])])
        # Exercise omp itself: a valid no-op extension must fail this case.
        mark=len(c.data); c.send("/vibe on\r")
        c.wait(lambda:"vibe mode ON" in c.text(mark))
        def assert_vibe(body):
            self.assert_persona(body,"開発")
            self.assertIn("Vibe mode is ON",json.dumps(body,ensure_ascii=False))
            names=[t["function"]["name"] for t in body.get("tools",[])]
            self.assertIn("read",names)
            for name in ("write","edit","bash"):
                self.assertNotIn(name,names)
        assert_vibe(self.prompt(c,"vibe fixture"))
        mark=len(c.data); c.send("/plan\r")
        c.wait(lambda:"Plan mode" in c.text(mark) or "plan mode" in c.text(mark))
        body=self.prompt(c,"vibe plus plan fixture"); assert_vibe(body)
        self.assertIn("[PLAN MODE ACTIVE]",json.dumps(body,ensure_ascii=False))
        mark=len(c.data); c.send("/reload\r")
        c.wait(lambda:"Reloaded" in c.text(mark) or "reloaded" in c.text(mark))
        self.assert_no_selector_output(c.text(mark))
        # omp resets its mode on reload; explicitly re-enable before checking it.
        mark=len(c.data); c.send("/vibe on\r")
        c.wait(lambda:"vibe mode ON" in c.text(mark))
        body=self.prompt(c,"vibe plus plan after reload"); assert_vibe(body)
        self.assertIn("[PLAN MODE ACTIVE]",json.dumps(body,ensure_ascii=False))
        mark=len(c.data); c.send("/plan\r")
        c.wait(lambda:"Plan mode" in c.text(mark) or "plan mode" in c.text(mark))
        assert_vibe(self.prompt(c,"vibe after plan off"))

    def preprofile_tree(self, c):
        mark=len(c.data); c.send("/fixture-preprofile\r")
        c.wait(lambda:"PREPROFILE_TREE_OK" in c.text(mark))

    def preprofile_helper(self):
        helper=self.home/"fixture-preprofile.ts"
        helper.write_text('export default function(pi){pi.registerCommand("fixture-preprofile",{handler:async(_,ctx)=>{const e=ctx.sessionManager.getEntries().find(e=>e.type==="model_change");await ctx.navigateTree(e.id,{summarize:false});ctx.ui.setEditorText("");ctx.ui.notify("PREPROFILE_TREE_OK","info");}});}')
        return helper

    def test_preprofile_tree_immediate_clone(self):
        c=self.child("--extension",str(self.preprofile_helper()))
        self.choose(c);self.prompt(c)
        self.preprofile_tree(c)
        mark=len(c.data);c.send("/clone\r");c.wait(lambda:"Cloned to new session" in c.text(mark))
        self.assert_no_selector_output(c.text(mark))
        self.assert_persona(self.prompt(c,"after preprofile clone"),"開発")

    def test_preprofile_tree_send_then_fork(self):
        c=self.child("--extension",str(self.preprofile_helper()))
        self.choose(c);self.prompt(c)
        self.preprofile_tree(c);self.assert_persona(self.prompt(c,"branched prompt"),"開発")
        path=self.session();c.close()
        self.run_mode("--fork",str(path),"--print","after preprofile fork")
        self.assert_persona(self.requests[-1],"開発")
        paths=list((self.agent/"sessions").rglob("*.jsonl"))
        forked=next(p for p in paths if p!=path)
        saved=[e["data"] for e in self.entries(forked) if e.get("customType")=="startup-profile-state"]
        self.assertTrue(saved,"fork must inherit the immutable snapshot")
        self.assertTrue(all(e["id"]=="developer" for e in saved))

    def legacy_only(self):
        # Only disposable copied fixture folders, never the checkout.
        for folder in self.profiles.iterdir():
            if folder.is_dir(): shutil.rmtree(folder)

    def test_duplicate_display_selects_second_id(self):
        self.legacy_only()
        (self.profiles/"a.md").write_text("A_ONLY_PERSONA")
        (self.profiles/"b.md").write_text("B_ONLY_PERSONA")
        (self.profiles/"catalog.json").write_text(json.dumps([
            {"id":"standard","label":"標準","description":"標準"},
            {"id":"alpha","label":"同じ","description":"説明","instructionsFile":"a.md"},
            {"id":"beta","label":"同じ","description":"説明","instructionsFile":"b.md"}]))
        c=self.child();c.wait(lambda:GUIDED_TITLE in c.text())
        c.send("\x1b[B\x1b[B\r");c.wait(lambda:"profile:同じ" in c.text())
        body=json.dumps(self.prompt(c),ensure_ascii=False)
        self.assertIn("B_ONLY_PERSONA",body);self.assertNotIn("A_ONLY_PERSONA",body)
        snapshot=next(e["data"] for e in self.entries(self.session()) if e.get("customType")=="startup-profile-state")
        self.assertEqual(snapshot["id"],"beta")

    def test_forced_prompt_before_profile(self):
        helper=self.home/"fixture-force.ts"
        helper.write_text('export default function(pi){pi.on("before_agent_start",event=>({systemPrompt:event.systemPrompt+"\\n\\nFORCED_FIXTURE_RULE"}));}')
        args=self.args()
        first=args.index("--extension")
        args[first:first]=["--extension",str(helper)]
        c=Child(args,self.env,self.cwd);self.children.append(c)
        self.choose(c)
        for prompt in ("forced first","forced second"):
            body=self.prompt(c,prompt);self.assert_persona(body,"開発")
            text=json.dumps(body,ensure_ascii=False)
            self.assertIn("FORCED_FIXTURE_RULE",text)
            self.assertEqual(text.count("# 開発profile"),1)

    def test_package_manifest_entry(self):
        self.load_as_package = True
        c=self.child(); self.choose(c)
        self.assert_persona(self.prompt(c),"開発")
        snapshots=[e for e in self.entries(self.session()) if e.get("customType")=="startup-profile-state"]
        self.assertEqual(len(snapshots),1,"the package must load exactly one profile extension")

    def test_invalid_catalog_falls_back(self):
        self.legacy_only()
        (self.profiles/"catalog.json").write_text("{not valid json")
        c=self.child(); c.wait(lambda:GUIDED_TITLE in c.text())
        c.send("\r"); c.wait(lambda:"profile:Other" in c.text())
        self.assert_persona(self.prompt(c),"標準")

    def test_invalid_saved_state_falls_back(self):
        c=self.child(); self.choose(c); self.prompt(c)
        path=self.session(); c.close()
        entries=self.entries(path)
        for entry in entries:
            if entry.get("customType")=="startup-profile-state":
                entry["data"]["version"]=99
        path.write_text("\n".join(json.dumps(e) for e in entries)+"\n")
        self.run_mode("--session",str(path),"--print","invalid fixture")
        self.assert_persona(self.requests[-1],"標準")

    def test_guided_focus_layout(self):
        self.install_many_profiles()
        for rows,columns in ((24,80),(16,40),(12,24)):
            with self.subTest(rows=rows,columns=columns):
                c=self.child(rows=rows,columns=columns)
                c.wait(lambda:"候補01" in c.screen_text() and "└" in c.screen_text())
                self.assertEqual(self.requests,[])
                screen=c.screen_text()
                self.assertIn("● 候補01",screen)
                if columns == 80:
                    first_row=next(index for index,line in enumerate(c.screen.lines()) if "説明 01" in line)
                    c.screen.reset_activity();c.send("\x1b[B");c.wait(lambda:"説明 02" in c.screen_text())
                    second_row=next(index for index,line in enumerate(c.screen.lines()) if "説明 02" in line)
                    self.assertEqual(first_row,second_row)
                    self.assert_selector_frame(c,["候補01","候補02","候補03","候補04","候補05","同じ候補","同じ候補","候補08","候補09","候補10","候補11","Other"],"候補02")
                    self.assert_no_terminal_overflow(c)
                if columns < 40:self.assertFalse(any(icon in screen for icon in ("🧭","📐","💻","🧹")))
                if columns == 40:
                    c.screen.reset_activity();c.send("\x1b[B"*6)
                    c.wait(lambda:"● 同じ候補" in c.screen_text() and "候補02" in c.screen_text() and "Other" in c.screen_text())
                    self.assert_selector_frame(c,["候補02","候補03","候補04","候補05","同じ候補","同じ候補","候補08","候補09","候補10","候補11","Other"],"同じ候補")
                    self.assert_no_terminal_overflow(c)
                if columns == 24:
                    c.screen.reset_activity();c.send("\x1b[B"*10)
                    c.wait(lambda:"11/12" in c.screen_text() and "● 候補11" in c.screen_text() and "Other" in c.screen_text())
                    self.assert_selector_frame(c,["同じ候補","候補08","候補09","候補10","候補11","Other"],"候補11")
                    self.assert_no_terminal_overflow(c)
                self.save_screen(f"{columns}x{rows}",c)
                c.close()

    def test_guided_focus_resize(self):
        c=self.child(rows=24,columns=80)
        c.wait(lambda:GUIDED_TITLE in c.screen_text() and "└" in c.screen_text())
        c.send("\x1b[B\x1b[B")
        c.wait(lambda:"● Development" in c.screen_text())
        wide_sentinel=GUIDED_TITLE
        self.assertIn(wide_sentinel,c.screen_text())
        c.screen.reset_activity();c.resize(16,40)
        c.wait(lambda:"● Development 💻" in c.screen_text() and "└" in c.screen_text())
        self.assert_selector_frame(c,["Research","Specification","Development","Chore（雑務）","Other"],"Development")
        self.assert_no_terminal_overflow(c);self.save_screen("40x16",c)
        c.screen.reset_activity();c.resize(12,24)
        c.wait(lambda:"● Development" in c.screen_text() and GUIDED_TITLE not in c.screen_text() and "└" in c.screen_text())
        narrow=c.screen_text()
        self.assertNotIn("Research      🧭",narrow)
        self.assertFalse(any(icon in narrow for icon in ("🧭","📐","💻","🧹")))
        self.assertIn("Enter",narrow);self.assertIn("Other",narrow)
        self.assertNotIn(wide_sentinel,narrow)
        self.assert_selector_frame(c,["Research","Specification","Development","Chore（雑務）","Other"],"Development")
        self.assert_no_terminal_overflow(c);self.save_screen("24x12",c)
        c.screen.reset_activity();c.resize(24,80)
        c.wait(lambda:GUIDED_TITLE in c.screen_text() and "● Development" in c.screen_text() and "└" in c.screen_text())
        self.assert_selector_frame(c,["Research","Specification","Development","Chore（雑務）","Other"],"Development")
        self.assert_no_terminal_overflow(c);self.save_screen("80x24-restored",c)
        c.send("\r");c.wait(lambda:"profile:Development" in c.text())

    def test_guided_focus_keybindings_icons_and_themes(self):
        (self.agent/"keybindings.json").write_text(json.dumps({
            "tui.select.up":"ctrl+p","tui.select.down":"ctrl+n",
            "tui.select.confirm":"ctrl+y","tui.select.cancel":"ctrl+g"}))
        expected={
            "dark":{"accent":b"\x1b[38;5;140m","muted":b"\x1b[38;5;145m","dim":b"\x1b[38;5;102m"},
            "light":{"accent":b"\x1b[38;5;97m","muted":b"\x1b[38;5;60m","dim":b"\x1b[38;5;102m"},
        }
        accents={}
        for theme in ("dark","light"):
            with self.subTest(theme=theme):
                c=self.child("--use-theme",theme,rows=24,columns=80)
                c.wait(lambda:"Ctrl+P/Ctrl+N 選択" in c.screen_text())
                selected=self.sgr_before_text(c,"● Research")
                description=self.sgr_before_text(c,"情報を調べ、出典付きの資料・表にまとめる")
                footer=self.sgr_before_text(c,"Ctrl+P/Ctrl+N 選択")
                self.assertIn(expected[theme]["accent"],selected);self.assertIn(b"\x1b[1m",selected)
                self.assertIn(expected[theme]["muted"],description)
                self.assertIn(expected[theme]["dim"],footer)
                accents[theme]=expected[theme]["accent"]
                self.save_screen(theme,c)
                c.send("\x07");c.wait(lambda:"profile:Other" in c.text());c.close()
        self.assertNotEqual(accents["dark"],accents["light"])
        self.env["PI_PROFILE_ICONS"]="0"
        c=self.child(rows=24,columns=80);c.wait(lambda:GUIDED_TITLE in c.screen_text() and "└" in c.screen_text())
        self.assertFalse(any(icon in c.screen_text() for icon in ("🧭","📐","💻","🧹")))
        c.send("\x0e\x0e")
        c.wait(lambda:"● Development" in c.screen_text())
        c.send("\x19");c.wait(lambda:"profile:Development" in c.text())

    def test_shutdown_during_selection(self):
        c=self.child(); c.wait(lambda:GUIDED_TITLE in c.screen_text() and "└" in c.screen_text())
        mark=len(c.data);os.killpg(c.p.pid,signal.SIGTERM)
        c.wait(lambda:c.p.poll() is not None)
        exited=len(c.data)
        try:os.write(c.master,b"\r")
        except OSError:pass
        c.pump(.1)
        self.assertEqual(len(c.data),exited,"output appeared after the observed process-exit boundary")
        self.assertNotIn("profile:",c.text(mark));self.assertNotIn("◇ Profile",c.text(mark))
        self.assertEqual(self.requests,[])
        self.assertFalse(list((self.agent/"sessions").rglob("*.jsonl")))

    def resource_fixture(self):
        self.resource_mode = True
        for name, marker in [('research','RESEARCH_SKILL_BODY'),('development','DEVELOPMENT_SKILL_BODY')]:
            folder=self.profiles/name
            skill=folder/'skills/profile-check';skill.mkdir(parents=True)
            (skill/'SKILL.md').write_text('---\nname: profile-check\ndescription: '+marker+'\n---\n'+marker)
            agents=folder/'agents';agents.mkdir()
            (agents/'helper.md').write_text('---\nname: helper\ndescription: helper\ntools: []\nskills: profile-check\n---\nCHILD_PROFILE_RULE')

    def test_profile_resource_lifecycle(self):
        self.resource_fixture()
        c=self.child();self.choose(c,0)
        body=self.prompt(c,'/skill:profile-check')
        self.assertIn('RESEARCH_SKILL_BODY',json.dumps(body))
        self.assertIn('<skill',json.dumps(body))
        path=self.session()
        mark=len(c.data);c.send('/new\r');c.wait(lambda:GUIDED_TITLE in c.text(mark))
        c.send('\x1b[B\x1b[B\r');c.wait(lambda:'profile:Development' in c.text(mark))
        body=self.prompt(c,'/skill:profile-check')
        self.assertIn('DEVELOPMENT_SKILL_BODY',json.dumps(body))
        self.assertNotIn('RESEARCH_SKILL_BODY',json.dumps(body))
        c.close()
        self.run_mode('--session',str(path),'--print','resume resource')
        system=json.dumps([m for m in self.requests[-1]['messages'] if m['role']=='system'])
        self.assertIn('RESEARCH_SKILL_BODY',system)
        self.assertNotIn('DEVELOPMENT_SKILL_BODY',system)
        skill=self.profiles/'research/skills/profile-check/SKILL.md'
        skill.write_text(skill.read_text().replace('RESEARCH_SKILL_BODY','UPDATED_SKILL_BODY'))
        c=self.child('--session',str(path));c.wait(lambda:'profile:Research' in c.text())
        mark=len(c.data);c.send('/reload\r');c.wait(lambda:'Reloaded' in c.text(mark) or 'reloaded' in c.text(mark))
        self.assertIn('UPDATED_SKILL_BODY',json.dumps(self.prompt(c,'/skill:profile-check')))
        mark=len(c.data);c.send('/clone\r');c.wait(lambda:'Cloned to new session' in c.text(mark))
        self.assertIn('UPDATED_SKILL_BODY',json.dumps(self.prompt(c,'clone resource')))
        # Remove discoverable fixture entries by moving them out of their scan paths.
        skill.rename(self.home/'removed-skill.md')
        agent=self.profiles/'research/agents/helper.md';agent.rename(self.home/'removed-agent.md')
        mark=len(c.data);c.send('/reload\r');c.wait(lambda:'Reloaded' in c.text(mark) or 'reloaded' in c.text(mark))
        body=self.prompt(c,'removed resource')
        system=json.dumps([m for m in body['messages'] if m['role']=='system'])
        self.assertNotIn('UPDATED_SKILL_BODY',system)
        self.assertNotIn('profile.research.helper',system)
        metadata=self.profiles/'research/profile.json'; data=json.loads(metadata.read_text());data['enabled']=False;metadata.write_text(json.dumps(data))
        mark=len(c.data);c.send('/reload\r');c.wait(lambda:'Reloaded' in c.text(mark) or 'reloaded' in c.text(mark))
        body=self.prompt(c,'disabled resource')
        system=json.dumps([m for m in body['messages'] if m['role']=='system'])
        self.assertNotIn('UPDATED_SKILL_BODY',system)
        self.assert_persona(body,'調査')

    def test_profile_subagent_resources(self):
        self.subagent_resources()

    def test_profile_extension_skill_before(self):
        self.subagent_resources('before')

    def test_profile_extension_skill_after(self):
        self.subagent_resources('after')

    def subagent_resources(self, extension_order=None, fixed_profile=False):
        if not OPTIONS.subagents_extension:
            self.skipTest('pass --subagents-extension for real child integration')
        self.resource_fixture()
        self.extra_extensions.append(Path(OPTIONS.subagents_extension))
        config=self.agent/'extensions/subagent';config.mkdir(parents=True)
        (config/'config.json').write_text(json.dumps({'toolActivation':'eager','intercomBridge':{'mode':'off'},'waitTool':{'enabled':False}}))
        settings=json.loads((self.agent/'settings.json').read_text())
        settings['subagents']={'defaultModel':'profile-fixture/fixture','defaultProvider':'profile-fixture'}
        (self.agent/'settings.json').write_text(json.dumps(settings));self.unchanged['settings.json']=(self.agent/'settings.json').read_bytes()
        common=self.agent/'agents';common.mkdir()
        (common/'reviewer.md').write_text('---\nname: reviewer\ndescription: common reviewer\ntools:\n---\nCOMMON_REVIEWER_RULE')
        shared=self.home/'shared/profile-check/SKILL.md';shared.parent.mkdir(parents=True)
        shared.write_text('---\nname: profile-check\ndescription: COMMON_SKILL_BODY\n---\nCOMMON_SKILL_BODY')
        # Explicit skill path is enabled even under --no-skills.
        if extension_order:
            helper=self.home/'common-skills.ts'
            helper.write_text('export default function(pi){pi.on("resources_discover",()=>({skillPaths:['+json.dumps(str(shared))+']}));}')
            (self.pre_extensions if extension_order=='before' else self.extra_extensions).append(helper)
        c=self.child(*([] if extension_order else ['--skill',str(shared)]));self.choose(c,0)
        parent=self.prompt(c,'catalog probe')
        self.assertIn('profile.research.helper',json.dumps(parent))
        system=json.dumps([m for m in parent['messages'] if m['role']=='system'])
        winner='COMMON_SKILL_BODY' if 'COMMON_SKILL_BODY' in system else 'RESEARCH_SKILL_BODY'
        if extension_order!='after':self.assertEqual(winner,'COMMON_SKILL_BODY')
        for name in ['reviewer','profile.research.helper']:
            for mode in ['foreground','background']:
                before=len(self.requests)
                self.prompt(c,'RUN_AGENT:'+name+':'+mode)
                c.wait(lambda:any(any(m.get('role')=='user' and 'CHILD_TASK' in str(m.get('content','')) for m in r.get('messages',[])) for r in self.requests[before:]),timeout=30)
                request=next(r for r in self.requests[before:] if any(m.get('role')=='user' and 'CHILD_TASK' in str(m.get('content','')) for m in r.get('messages',[])))
                text=json.dumps(request)
                self.assertIn('COMMON_REVIEWER_RULE' if name=='reviewer' else 'CHILD_PROFILE_RULE',text)
                if name!='reviewer':
                    self.assertIn(winner,text)
                    self.assertNotIn('RESEARCH_SKILL_BODY' if winner=='COMMON_SKILL_BODY' else 'COMMON_SKILL_BODY',text)
                self.assertNotIn('DEVELOPMENT_SKILL_BODY',text)
        mark=len(c.data);c.send('/new\r')
        if fixed_profile:
            c.wait(lambda:'New session started' in c.text(mark)); self.assert_no_selector_output(c.text(mark))
            body=json.dumps(self.prompt(c,'catalog after new')); self.assertIn('profile.research.helper',body); self.assertNotIn('profile.developer.helper',body)
            profile_id='research'; removed_marker='RESEARCH_SKILL_BODY'
        else:
            c.wait(lambda:GUIDED_TITLE in c.text(mark))
            c.send('\x1b[B\x1b[B\r');c.wait(lambda:'profile:Development' in c.text(mark))
            body=json.dumps(self.prompt(c,'catalog after new'));self.assertIn('profile.developer.helper',body);self.assertNotIn('profile.research.helper',body)
            profile_id='development'; removed_marker='DEVELOPMENT_SKILL_BODY'
        agent=self.profiles/profile_id/'agents/helper.md';agent.rename(self.home/'removed-helper.md')
        local_skill=self.profiles/profile_id/'skills/profile-check/SKILL.md';local_skill.rename(self.home/'removed-profile-skill.md')
        mark=len(c.data);c.send('/reload\r');c.wait(lambda:'Reloaded' in c.text(mark) or 'reloaded' in c.text(mark))
        body=self.prompt(c,'after resource removal')
        system=json.dumps([m for m in body['messages'] if m['role']=='system'])
        self.assertNotIn('profile.'+('research' if fixed_profile else 'developer')+'.helper',system)
        self.assertNotIn(removed_marker,system)

    def test_profile_home_separation(self):
        self.resource_fixture()
        sample=self.extension/'profiles/research/instructions.md'
        sample.write_text('# 調査profile\nSAMPLE_ONLY_RULE')
        sample_skill=self.extension/'profiles/research/skills/sample-only';sample_skill.mkdir(parents=True)
        (sample_skill/'SKILL.md').write_text('---\nname: sample-only\ndescription: SAMPLE_ONLY_SKILL\n---\nSAMPLE_ONLY_SKILL')
        sample_agent=self.extension/'profiles/research/agents';sample_agent.mkdir()
        (sample_agent/'sample-only.md').write_text('---\nname: sample-only\ndescription: SAMPLE_ONLY_AGENT\n---\nSAMPLE_ONLY_AGENT')
        personal=self.profiles/'research/instructions.md'
        personal.write_text('# 調査profile\nPERSONAL_HOME_RULE')
        extra=self.extension/'profiles/sample-only';extra.mkdir()
        (extra/'profile.json').write_text(json.dumps({'id':'sample-only','label':'SampleOnly','description':'SAMPLE_ONLY_PROFILE','order':1}))
        (extra/'instructions.md').write_text('SAMPLE_ONLY_RULE')
        c=self.child();self.choose(c,0)
        body=self.prompt(c,'/skill:profile-check')
        self.assertIn('PERSONAL_HOME_RULE',json.dumps(body))
        self.assertNotIn('SAMPLE_ONLY_RULE',json.dumps(body))
        self.assertNotIn('SAMPLE_ONLY_PROFILE',json.dumps(body))
        self.assertNotIn('SAMPLE_ONLY_SKILL',json.dumps(body))
        self.assertNotIn('SAMPLE_ONLY_AGENT',json.dumps(body))
        self.assertNotIn('profile.research.sample-only',json.dumps(body))
        self.assertIn('RESEARCH_SKILL_BODY',json.dumps(body))
        path=self.session()
        personal.write_text('# 調査profile\nNEW_PERSONAL_RULE')
        skill=self.profiles/'research/skills/profile-check/SKILL.md';skill.write_text(skill.read_text().replace('RESEARCH_SKILL_BODY','UPDATED_HOME_SKILL'))
        sample.write_text('# 調査profile\nCHANGED_SAMPLE_RULE')
        mark=len(c.data);c.send('/reload\r');c.wait(lambda:'Reloaded' in c.text(mark) or 'reloaded' in c.text(mark))
        body=self.prompt(c,'/skill:profile-check')
        self.assertIn('UPDATED_HOME_SKILL',json.dumps(body))
        system=json.dumps([m for m in body['messages'] if m['role']=='system'])
        self.assertIn('PERSONAL_HOME_RULE',system)
        self.assertNotIn('NEW_PERSONAL_RULE',system)
        self.assertNotIn('CHANGED_SAMPLE_RULE',system)
        c.close()
        self.run_mode('--session',str(path),'--print','resume separated fixture')
        self.assertIn('PERSONAL_HOME_RULE',json.dumps(self.requests[-1]))
        self.run_mode('--fork',str(path),'--print','fork separated fixture')
        self.assertIn('UPDATED_HOME_SKILL',json.dumps(self.requests[-1]))
        metadata=self.profiles/'research/profile.json';data=json.loads(metadata.read_text());data['enabled']=False;metadata.write_text(json.dumps(data))
        c=self.child();c.wait(lambda:GUIDED_TITLE in c.screen_text() and "└" in c.screen_text())
        options=self.selector_options(c)
        self.assertNotIn("Research",[label for _row,_selected,label in options])
        self.assertIn("Specification",[label for _row,_selected,label in options])
        c.send('\x1b');c.wait(lambda:'profile:Other' in c.text())
        system=json.dumps([m for m in self.prompt(c,'removed personal')['messages'] if m['role']=='system'])
        self.assertNotIn('UPDATED_HOME_SKILL',system)
        self.assertNotIn('CHANGED_SAMPLE_RULE',system)

    def test_profile_root_override(self):
        explicit=self.home/'custom';shutil.copytree(self.profiles,explicit)
        (self.profiles/'research/instructions.md').write_text('# 調査profile\nDEFAULT_HOME_RULE')
        (explicit/'research/instructions.md').write_text('# 調査profile\nEXPLICIT_ROOT_RULE')
        for override in [str(explicit),'~/custom','~//custom','~///custom']:
            self.env['PI_PROFILE_DIR']=override
            c=self.child();c.wait(lambda:GUIDED_TITLE in c.text())
            before=len(self.requests);c.send('\r');c.wait(lambda:'profile:Research' in c.text())
            self.assertEqual(len(self.requests),before)
            body=self.prompt(c,'explicit root')
            self.assertIn('EXPLICIT_ROOT_RULE',json.dumps(body))
            self.assertNotIn('DEFAULT_HOME_RULE',json.dumps(body));c.close()
        self.env['PI_PROFILE_DIR']='relative/profiles'
        c=self.child();c.wait(lambda:GUIDED_TITLE in c.text())
        c.send('\r');c.wait(lambda:'profile:Other' in c.text())
        system=json.dumps([m for m in self.prompt(c,'invalid root')['messages'] if m['role']=='system'])
        self.assertNotIn('EXPLICIT_ROOT_RULE',system);self.assertNotIn('DEFAULT_HOME_RULE',system)
        self.assertFalse((self.cwd/'relative').exists())

    def test_profile_unreadable_root(self):
        if hasattr(os,'geteuid') and os.geteuid()==0:self.skipTest('requires nonprivileged POSIX process')
        (self.profiles/'legacy.md').write_text('LEGACY_ROOT_RULE')
        (self.profiles/'catalog.json').write_text(json.dumps([{'id':'research','label':'Legacy','description':'','instructionsFile':'legacy.md'}]))
        os.chmod(self.profiles,0o111)
        try:
            self.assertIn('Legacy',(self.profiles/'catalog.json').read_text())
            c=self.child();c.wait(lambda:GUIDED_TITLE in c.text())
            c.send('\r');c.wait(lambda:'profile:Other' in c.text())
            body=self.prompt(c,'unreadable root fixture')
            system=json.dumps([m for m in body['messages'] if m['role']=='system'])
            self.assertNotIn('LEGACY_ROOT_RULE',system)
        finally:
            os.chmod(self.profiles,0o700)

if __name__ == "__main__":
    parser=argparse.ArgumentParser()
    parser.add_argument("--pi",default=shutil.which("pi"))
    parser.add_argument("--plan-extension")
    parser.add_argument("--omp-extension")
    parser.add_argument('--subagents-extension',help='installed pi-subagents index.js for explicit integration tests')
    parser.add_argument("--compatibility-only",action="store_true")
    parser.add_argument("--case")
    parser.add_argument("--without-extension",action="store_true",help="negative control: expected to fail")
    OPTIONS=parser.parse_args()
    if not OPTIONS.pi: parser.error("pi CLI not found")
    if OPTIONS.subagents_extension and not Path(OPTIONS.subagents_extension).is_file():
        parser.error('subagents extension path does not exist')
    requested = OPTIONS.compatibility_only or OPTIONS.case == "real_plan_and_omp_modes" or OPTIONS.plan_extension or OPTIONS.omp_extension
    if requested and not (OPTIONS.plan_extension and OPTIONS.omp_extension):
        parser.error("compatibility requires both --plan-extension and --omp-extension")
    if requested:
        for path in (OPTIONS.plan_extension, OPTIONS.omp_extension):
            if not Path(path).is_file(): parser.error("external extension path does not exist: "+path)
    if OPTIONS.compatibility_only:
        suite=unittest.TestSuite([Acceptance("test_real_plan_and_omp_modes")])
    elif OPTIONS.case:
        suite=unittest.TestSuite([Acceptance("test_"+OPTIONS.case)])
    else:
        suite=unittest.defaultTestLoader.loadTestsFromTestCase(Acceptance)
    result=unittest.TextTestRunner(verbosity=2).run(suite)
    raise SystemExit(0 if result.wasSuccessful() else 1)
