import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { copyFileSync, createReadStream, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, renameSync, rmdirSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { inspectContentRelease } from './inspect-content-release.mjs';

const installer = fileURLToPath(new URL('../deploy/install-content-delivery.py', import.meta.url));
const required = ['image','platform','program-version','input-version','library-id','release','compose','nginx','readiness','output'];
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

const contentDirs = new Set(['','assets','share-materials','share-materials/covers']);
const contentFiles = /^(knowledge\.sqlite|manifest\.json|assets\/[0-9a-f]{64}\.[a-z0-9]+|share-materials\/(catalog\.json|covers\/[a-z0-9]+(?:-[a-z0-9]+)*\.png))$/;

function copyEntry(source, target, contentPath) {
  const stat = lstatSync(source);
  if (contentDirs.has(contentPath) && stat.isDirectory()) {
    mkdirSync(target);
    for (const name of readdirSync(source).sort()) {
      copyEntry(join(source,name),join(target,name),contentPath ? contentPath+'/'+name : name);
    }
  } else if (stat.isFile() && stat.nlink === 1 && (contentPath === undefined || contentFiles.test(contentPath))) {
    copyFileSync(source,target);
  } else throw new Error('交付来源必须是独立普通文件或实体目录：' + source);
}

async function inventory(root, dir = root) {
  const files = [];
  for (const name of readdirSync(dir).sort()) {
    const path = join(dir,name), stat = lstatSync(path);
    if (stat.isDirectory()) files.push(...await inventory(root,path));
    else {
      const hash = createHash('sha256');
      for await (const chunk of createReadStream(path)) hash.update(chunk);
      files.push({path:relative(root,path),bytes:stat.size,sha256:hash.digest('hex')});
    }
  }
  return files;
}

export async function packageContentDelivery(options) {
  for (const key of required) if (!options[key]?.trim()) throw new Error('缺少参数 --'+key);
  const output = resolve(options.output);
  const parent = realpathSync(dirname(output));
  if (lstatSync(output,{throwIfNoEntry:false})) throw new Error('输出必须是新目录');
  if (!/^linux\/[a-z0-9_]+(?:\/v[0-9]+)?$/.test(options.platform) || options.image.startsWith('-')) {
    throw new Error('镜像或 Linux 平台无效');
  }
  const release = resolve(options.release);
  if (!lstatSync(release).isDirectory()) throw new Error('内容包必须是实体目录');
  const releaseRoot = realpathSync(release);
  if (parent===releaseRoot || parent.startsWith(releaseRoot+'/')) throw new Error('输出不能位于内容输入目录中');
  const temp = mkdtempSync(join(parent,'.content-delivery-'));
  const bundle = join(temp,'bundle');
  try {
    mkdirSync(bundle,{mode:0o700});
    // Inspect a frozen copy. Neither mutable source files nor an accidentally included
    // credentials directory can enter the published inventory after this check.
    copyEntry(release,join(bundle,'content'),'');
    const content = inspectContentRelease(join(bundle,'content'),options['library-id']);
    const manifest = JSON.parse(readFileSync(join(bundle,'content','manifest.json')));
    const db = new DatabaseSync(join(bundle,'content','knowledge.sqlite'),{readOnly:true});
    try {
      content.userVersion = db.prepare('PRAGMA user_version').get().user_version;
      content.inventorySha256 = db.prepare('SELECT inventory_digest FROM release_metadata').get().inventory_digest;
    } finally { db.close(); }
    content.inputs = manifest.inputs;
    for (const [key,name] of [['compose','compose.content.yaml'],['nginx','nginx.conf'],['readiness','readiness.conf']]) {
      copyEntry(resolve(options[key]),join(bundle,name));
    }
    const buildImageId = execFileSync('docker',['image','inspect','--format','{{.Id}}',options.image],{encoding:'utf8'}).trim();
    if (!/^sha256:[0-9a-f]{64}$/.test(buildImageId)) throw new Error('本机镜像 ID 无效');
    const raw = join(temp,'docker-save.tar');
    execFileSync('docker',['image','save','--output',raw,buildImageId],{stdio:['ignore','inherit','inherit']});
    const image = JSON.parse(execFileSync('python3',[installer,'prepare-image','--source',raw,'--output',join(bundle,'image.tar'),
      '--platform',options.platform],{encoding:'utf8'}));
    const files = await inventory(bundle);
    const delivery = {version:1,programVersion:options['program-version'],inputVersion:options['input-version'],
      image:{...image,buildImageId},content,files};
    const bytes = JSON.stringify(delivery,null,2)+'\n';
    writeFileSync(join(bundle,'delivery.json'),bytes,{flag:'wx'});
    mkdirSync(output,{mode:0o700});
    try { renameSync(bundle,output); } catch(error) { rmdirSync(output); throw error; }
    return {deliveryDirectory:join(parent,basename(output)),manifestSha256:sha256(bytes),imageId:buildImageId,imageRef:image.imageRef,platform:image.platform,configSha256:image.configSha256,
      imageManifestSha256:image.manifestSha256,content};
  } finally { rmSync(temp,{recursive:true,force:true}); }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try {
    const {values} = parseArgs({options:{...Object.fromEntries(required.map(k=>[k,{type:'string'}])),help:{type:'boolean'}}});
    if (values.help) console.log('node scripts/package-content-delivery.mjs ' + required.map(k=>'--'+k+' <value>').join(' '));
    else console.log(JSON.stringify(await packageContentDelivery(values),null,2));
  } catch(error) { console.error(error.message); process.exitCode=1; }
}
