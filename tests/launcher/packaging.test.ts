import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync,existsSync} from 'node:fs';
test('published bin is built JavaScript and host Pi is not bundled as a runtime dependency',()=>{
 const root=new URL('../../',import.meta.url),m=JSON.parse(readFileSync(new URL('package.json',root),'utf8'));
 assert.equal(m.bin?.['pi-profile'],'dist/src/cli.js');assert.equal(m.dependencies?.['@earendil-works/pi-coding-agent'],undefined);
 assert.ok(m.files.includes('src/'));assert.ok(m.files.includes('dist/'));assert.equal(typeof m.scripts.build,'string');
});

test('npm-style symlink bin actually invokes the CLI instead of silently exiting',async()=>{
 const fs=await import('node:fs'),os=await import('node:os'),path=await import('node:path'),cp=await import('node:child_process');
 const d=fs.mkdtempSync(path.join(os.tmpdir(),'profile-bin-link-')),file=path.join(d,'pi-profile');
 fs.symlinkSync(new URL('../../dist/src/cli.js',import.meta.url),file);
 const result=cp.spawnSync(process.execPath,[file,'--help'],{encoding:'utf8',timeout:3000});
 assert.equal(result.status,0,result.stderr);assert.ok(result.stdout.includes('pi-profile launch'),result.stdout);
});
