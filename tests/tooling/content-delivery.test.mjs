import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, copyFileSync, linkSync, mkdirSync, readFileSync, readdirSync, renameSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fixture } from './content-command-fixture.mjs';

const pack = 'scripts/package-content-delivery.mjs', install = 'deploy/install-content-delivery.py';
const sha = data => createHash('sha256').update(data).digest('hex');
const config = JSON.stringify({os:'linux',architecture:'arm64',rootfs:{type:'layers',diff_ids:[]}});
const configHash = sha(config), buildImageId = 'sha256:'+'1'.repeat(64);

function setup(t) {
  const data = fixture(t);
  const content = dirname(data.build());
  const uploads = join(data.root,'upload'), store = join(data.root,'versions'), bin = join(data.root,'bin');
  for (const dir of [store,bin,join(content,'share-materials','covers')]) mkdirSync(dir,{recursive:true});
  writeFileSync(join(content,'share-materials','catalog.json'), JSON.stringify({
    new:{id:'new',cardTitle:'新卡',title:'发布测试',description:''},
  }));
  writeFileSync(join(content,'share-materials','covers','new.png'), Buffer.from('89504e470d0a1a0a','hex'));
  const includes = ['compose.content.yaml','nginx.conf','readiness.conf'].map(name=>join(data.root,name));
  for (const file of includes) writeFileSync(file,'# fixture\n');
  const docker = join(bin,'docker');
  const log = join(data.root,'calls'), result = join(data.root,'imported.json');
  writeFileSync(docker, `#!/usr/bin/env python3
import json, pathlib, sys, tarfile
args = sys.argv[1:]
root = pathlib.Path(__file__).parent.parent
log = root/'calls'
state = root/'imported.json'
with log.open('a') as f:
    print(json.dumps(args),file=f)
if args[:2] == ['info','--format']:
    print('linux/x86_64' if (root/'wrong-host').exists() else 'linux/aarch64')
elif args[0:3] == ['image','inspect','--format']:
    print(${JSON.stringify(buildImageId)})
elif args[0:2] == ['image','save']:
    assert args[-1] in [${JSON.stringify(buildImageId)}, 'sha256:'+'c'*64, 'sha256:'+'a'*64]
    with tarfile.open(args[3],'w') as t:
        t.add(root/('wrong.json' if args[-1] == 'sha256:'+'a'*64 else 'config.json'),arcname='config.json')
        t.add(root/'arm.json',arcname='arm.json')
        t.add(root/'docker-manifest.json',arcname='manifest.json')
elif args[0:2] == ['image','ls']:
    if state.exists(): print('imported')
elif args[0:2] == ['image','load']:
    if (root/'fail-load').exists(): sys.exit(24)
    with tarfile.open(args[3]) as t:
        ref = json.load(t.extractfile('manifest.json'))[0]['RepoTags'][0]
        assert args[2] == '--input' and ref == 'concept-discovery-offline:${configHash}'
        ident = json.load(t.extractfile('index.json'))['manifests'][0]['digest']
    state.write_text(json.dumps([{'Id':ident, 'Architecture':'arm64','Os':'linux'}]))
elif args[0:2] == ['image','inspect']:
    print(state.read_text())
else:
    sys.exit(100)
`);
  chmodSync(docker,0o755);
  writeFileSync(join(data.root,'config.json'),config);
  writeFileSync(join(data.root,'wrong.json'),JSON.stringify({os:'linux',architecture:'arm64',config:{Env:['fixture=wrong']}}));
  writeFileSync(join(data.root,'arm.json'),JSON.stringify({os:'linux',architecture:'arm'}));
  writeFileSync(join(data.root,'docker-manifest.json'),JSON.stringify(['arm.json','config.json'].map(Config=>({Config,Layers:[],RepoTags:['existing:service']}))));
  const env = {...process.env,PATH:bin+':'+process.env.PATH};
  function run(exe,args) {
    const p = spawnSync(exe,args,{env,encoding:'utf8'});
    if (p.error) throw p.error;
    return p;
  }
  function ok(p) { assert.equal(p.status,0,p.stderr); return JSON.parse(p.stdout); }
  function packageTo(output = uploads,platform = 'linux/arm64') {
    return run(process.execPath,[pack,'--image','fixture:local','--platform',platform,'--program-version','program-1',
      '--input-version','raw-1','--library-id','fixture','--release',content,'--compose',includes[0],
      '--nginx',includes[1],'--readiness',includes[2],'--output',output]);
  }
  function installAt(pin) {
    return run('python3',[install,'--delivery',uploads,'--manifest-sha256',pin,'--install-root',store]);
  }
  return {data,uploads,store,log,result,ok,packageTo,installAt};
}

test('local package and offline install pin one target image, complete SQLite inventory and share material', t=>{
  const {uploads,store,log,result,ok,packageTo,installAt} = setup(t);
  const receipt = ok(packageTo());
  assert.equal(receipt.configSha256,configHash);
  assert.equal(receipt.imageId,buildImageId);
  assert.equal(receipt.platform,'linux/arm64');
  const manifest = JSON.parse(readFileSync(join(uploads,'delivery.json')));
  assert.equal(manifest.content.activeCount,2);
  assert.equal(manifest.content.userVersion,2);
  assert.equal(manifest.content.readerContract,1);
  assert.match(manifest.content.inventorySha256,/^[a-f0-9]{64}$/);
  assert.ok(manifest.files.some(file=>file.path==='content/share-materials/covers/new.png'));
  assert.notEqual(packageTo().status,0);
  const installed = ok(installAt(receipt.manifestSha256));
  assert.equal(installed.imageId,'sha256:'+manifest.image.manifestSha256);
  assert.deepEqual(readdirSync(store),[receipt.manifestSha256]);
  assert.deepEqual(readFileSync(join(installed.contentDirectory,'knowledge.sqlite')),readFileSync(join(uploads,'content','knowledge.sqlite')));
  assert.deepEqual(ok(installAt(receipt.manifestSha256)),installed);
  assert.equal(readFileSync(log,'utf8').split('\n').filter(s=>s.includes('"load"')).length,1);
  // Classic Docker reports the config ID for exactly the same program.
  writeFileSync(result,JSON.stringify([{Id:'sha256:'+configHash,Os:'linux',Architecture:'arm64'}]));
  assert.equal(ok(installAt(receipt.manifestSha256)).imageId,'sha256:'+configHash);
  // A different wrapper index is usable after reading back its exact platform config from the daemon.
  writeFileSync(result,JSON.stringify([{Id:'sha256:'+'c'.repeat(64),Os:'linux',Architecture:'arm64'}]));
  assert.equal(ok(installAt(receipt.manifestSha256)).imageId,'sha256:'+'c'.repeat(64));
  writeFileSync(join(installed.contentDirectory,'manifest.json'),'{}');
  assert.notEqual(installAt(receipt.manifestSha256).status,0);
  assert.equal(readFileSync(join(installed.contentDirectory,'manifest.json'),'utf8'),'{}');
});

test('digest, file type, image import and inventory failures leave the previous release intact', t=>{
  const {data,uploads,store,log,result,ok,packageTo,installAt} = setup(t);
  const pin = ok(packageTo()).manifestSha256;
  assert.notEqual(packageTo(join(data.root,'wrong'),'linux/amd64').status,0);
  const previous = join(store,'previous');
  mkdirSync(previous);
  writeFileSync(join(previous,'sentinel'),'until next release');
  const failed = (candidate = pin) => {
    assert.notEqual(installAt(candidate).status,0);
    assert.deepEqual(readdirSync(store),['previous']);
    assert.equal(readFileSync(join(previous,'sentinel'),'utf8'),'until next release');
  };
  failed('0'.repeat(64));
  writeFileSync(join(data.root,'wrong-host'),'yes');
  failed();
  assert.equal(readFileSync(log,'utf8').includes('"load"'),false);
  unlinkSync(join(data.root,'wrong-host'));
  const archived = join(uploads,'readiness.conf'), outside = join(data.root,'outside');
  renameSync(archived,outside);
  symlinkSync(outside,archived);
  failed();
  unlinkSync(archived);
  linkSync(outside,archived);
  failed();
  unlinkSync(archived);
  copyFileSync(outside,archived);
  writeFileSync(join(uploads,'auth.sqlite'),'should stay separate');
  failed();
  unlinkSync(join(uploads,'auth.sqlite'));
  writeFileSync(archived,'tampered');
  failed();
  copyFileSync(outside,archived);
  const mf = join(uploads,'delivery.json'), bytes = readFileSync(mf), parsed = JSON.parse(bytes);
  parsed.content.userVersion++;
  writeFileSync(mf,JSON.stringify(parsed));
  failed(sha(readFileSync(mf)));
  writeFileSync(mf,bytes);
  assert.equal(readFileSync(log,'utf8').includes('"load"'),false);
  writeFileSync(join(data.root,'fail-load'),'yes');
  failed();
  unlinkSync(join(data.root,'fail-load'));
  writeFileSync(result,JSON.stringify([{Id:'sha256:'+'a'.repeat(64),Os:'linux',Architecture:'arm64'}]));
  failed();
  unlinkSync(result);
  assert.equal(ok(installAt(pin)).configSha256,configHash);
});
