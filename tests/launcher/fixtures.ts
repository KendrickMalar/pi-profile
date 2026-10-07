import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import { once } from 'node:events';

export interface RpcRecord { type: string; id?: string; command?: string; success?: boolean; data?: any; [key: string]: any }
const PI = '/opt/homebrew/bin/pi';
const SDK = '/opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent/dist/index.js';

/** Native CLI characterization only; this helper is not part of the product. */
export class NativeFixture {
  readonly root = mkdtempSync(join(tmpdir(), 'profile-native-'));
  readonly agent = join(this.root, 'agent');
  readonly cwd = join(this.root, 'cwd');
  readonly store = join(this.root, 'store');
  readonly audit = join(this.root, 'audit.log');
  readonly packageRoot = join(this.store, 'npm/node_modules/profile-native-package');
  readonly packageEntry = join(this.packageRoot, 'index.ts');
  readonly bridge = join(this.root, 'bridge.mjs');
  readonly calls: any[] = [];
  readonly records: RpcRecord[] = [];
  readonly children: ChildProcess[] = [];
  readonly env: NodeJS.ProcessEnv;
  stdout = ''; stderr = '';
  private server: Server;
  private requestId = 0;

  constructor() {
    for (const p of [this.agent, this.cwd, this.packageRoot, join(this.root, 'tmp')]) mkdirSync(p, { recursive: true });
    writeFileSync(join(this.agent, 'auth.json'), '{}', { mode: 0o600 });
    writeFileSync(join(this.agent, 'settings.json'), JSON.stringify({ packages: [], extensions: [], theme: 'dark', quietStartup: true, lastChangelogVersion: '1.0.4', enableAnalytics: false, enableInstallTelemetry: false }));
    this.env = {
      HOME: this.root, TMPDIR: join(this.root, 'tmp'), PI_CODING_AGENT_DIR: this.agent,
      PI_CODING_AGENT_SESSION_DIR: join(this.agent, 'sessions'),
      PATH: '/opt/homebrew/bin:/usr/bin:/bin', TERM: 'xterm-256color', LANG: 'en_US.UTF-8',
      // Explicit fixture isolation. The future launcher must not introduce this itself.
      PI_OFFLINE: '1', PI_SKIP_VERSION_CHECK: '1', PI_TELEMETRY: '0',
      XDG_CONFIG_HOME: join(this.root, 'xdg-config'), XDG_CACHE_HOME: join(this.root, 'xdg-cache'),
      XDG_DATA_HOME: join(this.root, 'xdg-data'), XDG_STATE_HOME: join(this.root, 'xdg-state'),
      PROFILE_NATIVE_AUDIT: this.audit,
    };
    this.server = createServer(async (request, response) => {
      const bytes: Buffer[] = [];
      for await (const chunk of request) bytes.push(Buffer.from(chunk));
      this.calls.push(JSON.parse(Buffer.concat(bytes).toString()));
      response.writeHead(200, { 'Content-Type': 'text/event-stream' });
      for (const [delta, finish_reason] of [[{ role: 'assistant', content: 'FIXTURE_OK' }, null], [{}, 'stop']] as const) {
        response.write('data: ' + JSON.stringify({ id: 'fixture', object: 'chat.completion.chunk', created: 1, model: 'fixture', choices: [{ index: 0, delta, finish_reason }] }) + '\n\n');
      }
      response.end('data: [DONE]\n\n');
    });
  }

  async start() {
    this.server.listen(0, '127.0.0.1');
    await once(this.server, 'listening');
    const address = this.server.address();
    if (!address || typeof address === 'string') throw new Error('Fixture server did not bind');
    writeFileSync(join(this.agent, 'models.json'), JSON.stringify({ providers: { 'profile-native': { baseUrl: `http://127.0.0.1:${address.port}/v1`, api: 'openai-completions', apiKey: 'FAKE_LOCAL_KEY', models: [{ id: 'fixture', contextWindow: 32768, maxTokens: 256 }] } } }));
    return this;
  }

  makePackage(hookOnly = false) {
    mkdirSync(join(this.packageRoot, 'skills/native-skill'), { recursive: true });
    mkdirSync(join(this.packageRoot, 'prompts'), { recursive: true });
    mkdirSync(join(this.packageRoot, 'themes'), { recursive: true });
    writeFileSync(join(this.packageRoot, 'package.json'), JSON.stringify({ name: 'profile-native-package', version: '1.0.0', type: 'module', pi: { extensions: ['./index.ts'], skills: ['./skills'], prompts: ['./prompts'], themes: ['./themes'] } }));
    writeFileSync(join(this.packageRoot, 'skills/native-skill/SKILL.md'), '---\nname: native-skill\ndescription: NATIVE_SKILL_DESCRIPTION\n---\nNATIVE_SKILL_BODY\n');
    writeFileSync(join(this.packageRoot, 'prompts/native-prompt.md'), '---\ndescription: NATIVE_PROMPT_DESCRIPTION\n---\nNATIVE_PROMPT_BODY\n');
    // Discovery is tested without selecting this theme, so validity/appearance is not inferred.
    writeFileSync(join(this.packageRoot, 'themes/native-theme.json'), '{}');
    writeFileSync(this.packageEntry, `import {appendFileSync} from 'node:fs';\nconst audit=s=>appendFileSync(process.env.PROFILE_NATIVE_AUDIT,s+'\\n');\naudit('package-import');\nenum LoadedMarker { Ready = 'ready' }\nexport default function(api: any){\n audit('package-factory');\n api.on('agent_start',()=>audit('package-agent-start'));\n ${hookOnly ? '' : "api.registerTool({name:'native_package_tool',label:'Native package',description:'NATIVE_TOOL_DESCRIPTION',parameters:{type:'object',properties:{}},execute:async()=>({content:[{type:'text',text:'local'}],details:undefined})});"}\n}\n`);
  }

  /** The minimal public-API connection the plan's first gate evaluates. */
  makeBridge(resolveOnReload: boolean) {
    const corrupt = "import {appendFileSync} from 'node:fs'; enum BrokenMarker { Failed = 'failed' } export default function(){appendFileSync(process.env.PROFILE_NATIVE_AUDIT,'broken-factory-entered\\n');throw new Error('NATIVE_FACTORY_BROKEN');}";
    writeFileSync(this.bridge, `import {appendFileSync,writeFileSync} from 'node:fs';\nimport {DefaultPackageManager,SettingsManager} from ${JSON.stringify(SDK)};\nconst audit=s=>appendFileSync(process.env.PROFILE_NATIVE_AUDIT,s+'\\n');\nexport default function(api){\n const manager=new DefaultPackageManager({cwd:${JSON.stringify(this.cwd)},agentDir:${JSON.stringify(this.store)},settingsManager:SettingsManager.inMemory({packages:[${JSON.stringify(this.packageRoot)}]})});\n api.on('session_shutdown',async event=>{if(event.reason==='reload'){${resolveOnReload ? "await manager.resolve(); audit('profile-resolved');" : ''}}});\n api.registerCommand('native-reload',{description:'Fixture reload',handler:async(_args,ctx)=>{await ctx.reload();}});\n api.registerCommand('native-break',{description:'Fixture package corruption',handler:async(_args,ctx)=>{writeFileSync(${JSON.stringify(this.packageEntry)},${JSON.stringify(corrupt)});await ctx.reload();}});\n api.on('session_start',()=>audit('bridge-start'));\n}\n`);
  }
  makeScopeBridge(guard: boolean) {
    const ownerFile = join(this.root, 'scope-owner.json');
    writeFileSync(this.bridge, `import {appendFileSync,existsSync,readFileSync,writeFileSync} from 'node:fs';
import {DefaultResourceLoader,SettingsManager,SessionManager,createAgentSession} from ${JSON.stringify(SDK)};
const audit=s=>appendFileSync(process.env.PROFILE_NATIVE_AUDIT,s+'\\n');
export default function(api){
 api.on('session_start',(_event,ctx)=>{
  const owner=existsSync(${JSON.stringify(ownerFile)})?JSON.parse(readFileSync(${JSON.stringify(ownerFile)},'utf8')):undefined;
  if(${guard} && owner && (owner.pid!==process.pid || owner.id!==ctx.sessionManager.getSessionId())){audit('scope-child-ignored');return;}
  if(!owner)writeFileSync(${JSON.stringify(ownerFile)},JSON.stringify({pid:process.pid,id:ctx.sessionManager.getSessionId()}),{mode:0o600});
  audit('scope-managed-start');audit('bridge-start');
 });
 api.registerCommand('native-child',{description:'Synthetic SDK child',handler:async(_args,ctx)=>{
  const settings=SettingsManager.inMemory({packages:[],theme:'dark'});
  const loader=new DefaultResourceLoader({cwd:ctx.cwd,agentDir:${JSON.stringify(this.agent)},settingsManager:settings,noExtensions:true,noSkills:true,noPromptTemplates:true,noThemes:true,noContextFiles:true,additionalExtensionPaths:[${JSON.stringify(this.bridge)}]});
  await loader.reload();
  const {session}=await createAgentSession({cwd:ctx.cwd,agentDir:${JSON.stringify(this.agent)},model:ctx.model,settingsManager:settings,resourceLoader:loader,sessionManager:SessionManager.inMemory(ctx.cwd)});
  await session.bindExtensions({mode:'print'});
  if(session.extensionRunner.hasHandlers('session_shutdown'))await session.extensionRunner.emit({type:'session_shutdown',reason:'quit'});
  session.dispose();audit('child-bind-finished');
 }});
}
`);
  }


  async startRpc(expectReady = true) {
    const args = ['--offline', '--mode', 'rpc', '--no-extensions', '--model', 'profile-native/fixture', '-e', this.packageRoot, '-e', this.bridge];
    const child = spawn(PI, args, { cwd: this.cwd, env: this.env, stdio: ['pipe', 'pipe', 'pipe'] });
    this.children.push(child);
    let pending = '';
    child.stdout!.on('data', (chunk: Buffer) => {
      this.stdout += chunk.toString(); pending += chunk.toString();
      for (;;) {
        const end = pending.indexOf('\n'); if (end < 0) break;
        const line = pending.slice(0, end); pending = pending.slice(end + 1);
        if (line.trim()) { try { this.records.push(JSON.parse(line)); } catch {} }
      }
    });
    child.stderr!.on('data', chunk => { this.stderr += chunk.toString(); });
    if (expectReady) await this.waitUntil(() => this.events().includes('bridge-start'), 10_000);
    return child;
  }

  async command(child: ChildProcess, type: string, input: Record<string, unknown> = {}) {
    const id = String(++this.requestId);
    child.stdin!.write(JSON.stringify({ id, type, ...input }) + '\n');
    await this.waitUntil(() => this.records.some(r => r.type === 'response' && r.id === id), 10_000);
    return this.records.find(r => r.type === 'response' && r.id === id)!;
  }

  events() { return existsSync(this.audit) ? readFileSync(this.audit, 'utf8').trim().split('\n') : []; }
  async waitUntil(predicate: () => boolean, timeout = 5_000) {
    const deadline = Date.now() + timeout;
    while (!predicate()) {
      if (Date.now() > deadline) throw new Error(`Fixture timeout. stderr=${this.stderr.slice(-2000)} stdout=${this.stdout.slice(-2000)}`);
      await new Promise(resolve => setTimeout(resolve, 20));
    }
  }

  async dispose() {
    for (const child of this.children) {
      if (child.exitCode === null && child.signalCode === null) {
        const ended = once(child, 'exit'); child.kill('SIGTERM');
        await Promise.race([ended, new Promise(resolve => setTimeout(resolve, 2000))]);
        if (child.exitCode === null && child.signalCode === null) { child.kill('SIGKILL'); await ended; }
      }
    }
    this.server.closeAllConnections();
    await new Promise<void>(resolve => this.server.close(() => resolve()));
    writeFileSync(join(this.root, 'stdout.jsonl'), this.stdout);
    writeFileSync(join(this.root, 'stderr.log'), this.stderr);
    writeFileSync(join(this.root, 'requests.json'), JSON.stringify(this.calls, null, 2));
    console.log(`Evidence: ${this.root}`);
  }
}
