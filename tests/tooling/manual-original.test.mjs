import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { loadRawTree } from '../../lib/raw-format.mjs';
import { planManualOriginal } from '../../scripts/manual-original-plan.mjs';
import { removeCardOriginal } from '../../scripts/remove-card-original.mjs';

function fixture(t) {
  const tree=mkdtempSync(join(tmpdir(),'cd-original-cli-'));
  t.after(()=>rmSync(tree,{recursive:true,force:true}));
  const git=(...args)=>execFileSync('git',['-c','core.hooksPath=/dev/null',...args],{cwd:tree,encoding:'utf8'}).trim();
  function write(path,bytes) {
    mkdirSync(dirname(join(tree,path)),{recursive:true});
    writeFileSync(join(tree,path),bytes);
  }
  git('init','-q','-b','main');
  git('config','user.name','Synthetic'); git('config','user.email','synthetic@example.invalid');
  const discipline="合成's $分组";
  const path=id=>discipline+'/'+id+'/article.md';
  const documentId='20261125100000-synth01';
  const card=(id,body)=>write('raw/'+path(id),'---\nname: 合成'+id+'\n---\n\n## 核心理解\n\n'+body+'\n');
  card('keep','![共图](../a/assets/share.png)'); card('a','第一张'); card('b','第二张');
  write('raw/'+discipline+'/a/assets/share.png',Buffer.from([0,2,1,0]));
  write('raw/'+discipline+'/README.md','1. [甲](<a/article.md>)\n2. [乙](<b/article.md>)\n');
  write('raw/README.md','学科导读共收录 2 张知识卡。\n');
  write('raw/.sync.json',JSON.stringify({version:1,identity:'synthetic',cards:{a:{path:path('a')},b:{path:path('b')}}}));
  write('server/share-materials/catalog.json',JSON.stringify({a:{id:'a'},b:{id:'b'}}));
  write('server/share-materials/covers/a.png','only A');
  git('add','--','raw','server'); git('commit','-qm','synthetic');
  const plan=rawId=>planManualOriginal({tree,rawId,documentId,sourcePath:path(rawId)});
  const apply=(id,p)=>removeCardOriginal(tree,[id,documentId,path(id),p.digest]);
  return {tree,git,write,path,card,plan,apply,discipline};
}

test('两个原稿命令可在同一工作区依次暂存，保留共享图片和其他未提交工作', t=>{
  const f=fixture(t), head=f.git('rev-parse','HEAD'), a=f.plan('a'), b=f.plan('b');
  assert.deepEqual(a.blockers,[]);
  assert.ok(a.paths.includes('raw/'+f.path('a')));
  // Let a POSIX shell parse the displayed arguments, without invoking a deletion.
  const args=execFileSync('sh',['-c','set -- '+a.command.slice('node scripts/remove-card-original.mjs '.length)+'; printf "%s\\0" "$@"']);
  assert.deepEqual(args.toString().split('\0').slice(0,-1),['a','20261125100000-synth01',f.path('a'),a.digest]);
  f.write('other.txt','独立工作'); f.git('add','--','other.txt');
  f.apply('a',a);
  assert.equal(f.plan('b').digest,b.digest);
  f.apply('b',b);
  assert.equal(f.git('rev-parse','HEAD'),head);
  assert.equal(f.git('show',':other.txt'),'独立工作');
  const tree=loadRawTree(join(f.tree,'raw'),{references:true});
  assert.deepEqual(tree.cards.map(x=>x.id),['keep']);
  const to=a.moves.get(f.discipline+'/a/assets/share.png');
  assert.deepEqual([...tree.inbound.get(to)],[f.path('keep')]);
  assert.deepEqual(tree.files.get(to),Buffer.from([0,2,1,0]));
  assert.deepEqual(JSON.parse(readFileSync(join(f.tree,'server/share-materials/catalog.json'))),{});
  assert.equal(existsSync(join(f.tree,'server/share-materials/covers/a.png')),false);
});

test('过期命令、来源路径错配和依赖冲突保留工作区及暂存区', t=>{
  const f=fixture(t), plan=f.plan('a'), staged=f.git('write-tree');
  f.card('a','需要保留的本地编辑');
  assert.throws(()=>f.apply('a',plan),/不符/);
  assert.throws(()=>f.apply('a',f.plan('a')),/已有本地变更/);
  assert.equal(f.git('write-tree'),staged);
  f.card('keep','[仍需要甲](../a/article.md)');
  assert.equal(f.plan('a').command,null);
  const wrong=planManualOriginal({tree:f.tree,rawId:'a',documentId:'20261125100000-synth01',sourcePath:f.path('b')});
  assert.equal(wrong.command,null);
  assert.ok(existsSync(join(f.tree,'raw',f.path('a'))));
});

test('暂存区的新增卡片引用也会阻止删除，即使工作树恢复了原状', t=>{
  const f=fixture(t), plan=f.plan('b');
  const original=readFileSync(join(f.tree,'raw',f.path('keep')));
  f.card('keep','[仍需要乙](../b/article.md)');
  f.git('add','--','raw/'+f.path('keep'));
  f.write('raw/'+f.path('keep'),original);
  const tree=f.git('write-tree');
  assert.equal(f.plan('b').digest,plan.digest);
  assert.throws(()=>f.apply('b',plan),/暂存区的原稿引用/);
  assert.equal(f.git('write-tree'),tree);
  assert.ok(existsSync(join(f.tree,'raw',f.path('b'))));
});
