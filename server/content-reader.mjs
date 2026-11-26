import { createHash } from 'node:crypto';
import { lstatSync, readdirSync, readFileSync, realpathSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { inventoryDigest, openContentStore } from '../lib/content-reader-store.mjs';
import { createContentCommands } from '../lib/content-commands.mjs';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
function regular(root, name) {
  const path = join(root,name);
  if (realpathSync(path)!==path || !lstatSync(path).isFile()) throw new Error('内容包文件不是受管普通文件');
  return path;
}

// Resolve the version directory once; a later change to the current-release symlink
// must not mix a database, files or view validators from different releases.
export function openContentReader({directory,libraryId,origin,manifestSha256}) {
  const root = realpathSync(directory);
  const bytes = readFileSync(regular(root,'manifest.json'));
  const actualManifestSha256 = hash(bytes);
  if (manifestSha256 !== undefined && actualManifestSha256!==manifestSha256) throw new Error('候选内容清单摘要不符');
  const manifest = JSON.parse(bytes);
  if (manifest.version!==1 || !libraryId || manifest.libraryId!==libraryId || !Array.isArray(manifest.files)) {
    throw new Error('候选内容包的格式或库身份不符');
  }
  const files = new Map();
  for (const {path,sha256} of manifest.files) {
    if ((path!=='knowledge.sqlite' && !/^assets\/[a-f0-9]{64}\.[a-z0-9]+$/.test(path)) ||
        !/^[a-f0-9]{64}$/.test(sha256) || files.has(path)) throw new Error('候选文件清单无效');
    if (hash(readFileSync(regular(root,path)))!==sha256) throw new Error('候选文件与清单摘要不符：'+path);
    files.set(path,sha256);
  }
  if (!files.has('knowledge.sqlite')) throw new Error('候选文件缺少内容库');
  // A live SQLite journal could change which pages SQLite sees after the database was hashed.
  for (const suffix of ['-wal', '-shm', '-journal']) {
    if (lstatSync(join(root, 'knowledge.sqlite' + suffix), {throwIfNoEntry: false})) throw new Error('候选内容库含未封存的 SQLite 运行文件');
  }
  const allowedRoot = new Set(['manifest.json','knowledge.sqlite','assets','share-materials']);
  if (readdirSync(root).some(name=>!allowedRoot.has(name)) || !lstatSync(join(root,'assets')).isDirectory())
    throw new Error('候选目录含未封存的文件或附件目录无效');
  const expectedAssets=[...files.keys()].filter(path=>path.startsWith('assets/')).sort();
  const actualAssets=readdirSync(join(root,'assets')).map(name=>'assets/'+name).sort();
  if (JSON.stringify(actualAssets)!==JSON.stringify(expectedAssets)) throw new Error('候选附件目录含未核准或缺失的文件');
  const store = openContentStore(regular(root,'knowledge.sqlite'));
  try {
    const {reservedIdentities} = manifest;
    if (store.inventoryDigest!==inventoryDigest(manifest)) {
      throw new Error('候选内容库与历史身份库存不符');
    }
    const assets = store.assetManifest();
    if (assets.length!==files.size-1 || assets.some(row=>files.get('assets/'+row.filename)!==row.hash)) {
      throw new Error('数据库附件与发布清单不符');
    }
    const dispatch = createContentCommands(store,{origin});
    const views = new Map();
    for (const name of ['graph','scenarios']) {
      const body=Buffer.from(JSON.stringify({ok:true,data:store.view(name)}));
      const etag='"'+hash(Buffer.concat([Buffer.from(files.get('knowledge.sqlite')+'\0'+name+'\0'),body]))+'"';
      views.set(name,{body,etag});
    }
    async function readAssetBytes(path,signal) {
      signal?.throwIfAborted();
      const asset=store.asset(path);
      if (!asset) return null;
      const file='assets/'+asset.filename;
      try {
        if (files.get(file)!==asset.hash) throw new Error('附件未列入该版本');
        const bytes=await readFile(regular(root,file),{signal});
        if (bytes.length!==asset.size || hash(bytes)!==asset.hash) throw new Error('附件版本已变化');
        const etag=path==='/'+file && asset.mime.startsWith('image/') ? '"'+asset.hash+'"' : undefined;
        return {bytes,mime:asset.mime,etag};
      } catch (error) {
        if (signal?.aborted) throw error;
        throw Object.assign(new Error('候选附件暂时无法核实'),{code:'content_unavailable'});
      }
    }
    return {
      dispatch, activeMain: store.activeMain,
      inventory() {
        const reservedMainIds = reservedIdentities
          .filter(([ref,id,anchor,parent])=>ref===id && anchor==='' && parent==='').map(([,id])=>id);
        return {libraryId, manifestSha256:actualManifestSha256, readerContract:1,
          ...store.publicInventory(), reservedMainIds, reservedRefs:reservedIdentities.map(([ref])=>ref)};
      },
      readView(name) {
        const view=views.get(name);
        if (!view) throw Object.assign(new Error('视图不存在'),{code:'not_found'});
        return view;
      },
      readAssetBytes,
      async readAsset(path,signal) {
        const asset=await readAssetBytes(path,signal);
        if (!asset) return new Response(null,{status:404});
        const headers={'Content-Type':asset.mime,'Content-Length':String(asset.bytes.length)};
        if (asset.etag) headers.ETag=asset.etag;
        return new Response(asset.bytes,{headers});
      },
      close:store.close,
    };
  } catch (error) {
    store.close();
    throw error;
  }
}
