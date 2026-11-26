import { createHash } from 'node:crypto';
import { lstatSync, readdirSync, readFileSync, realpathSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';

const sha256=bytes=>createHash('sha256').update(bytes).digest('hex');
const plain=value=>value !== null && typeof value==='object' && !Array.isArray(value);
function checkedFile(path) {
  if(realpathSync(path)!==path || !lstatSync(path).isFile()) throw new Error('转发素材需为版本目录内的普通文件');
  return readFileSync(path);
}

// The selected directory is a version, not a mutable pointer. Each cover is
// rechecked when used so a changed host file cannot become an approved preview.
export function openContentShareMaterials(directory,reader) {
  const materials=new Map(), inventory=[];
  const requested=resolve(directory);
  const root=join(realpathSync(dirname(requested)),basename(requested));
  if (lstatSync(root,{throwIfNoEntry:false})) {
    if(realpathSync(root)!==root || !lstatSync(root).isDirectory()) throw new Error('转发素材目录无效');
    const entries=readdirSync(root).sort();
    if(entries.some(name=>!['catalog.json','covers'].includes(name))) throw new Error('转发素材目录含未列入版本的文件');
    const catalogBytes=checkedFile(join(root,'catalog.json'));
    const catalog=JSON.parse(catalogBytes);
    if(!plain(catalog)) throw new Error('转发素材目录清单无效');
    inventory.push(['catalog.json',sha256(catalogBytes)]);
    const names=Object.keys(catalog).sort();
    const covers=join(root,'covers');
    const coverDir=lstatSync(covers,{throwIfNoEntry:false});
    if (coverDir && !coverDir.isDirectory()) throw new Error('专属封面目录必须是独立实体目录');
    const found=coverDir ? readdirSync(covers).sort() : [];
    if (JSON.stringify(found)!==JSON.stringify(names.map(id=>id+'.png').sort())) throw new Error('专属封面与素材目录不一致');
    for(const id of names) {
      if(!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id)) throw new Error('转发原稿标识无效');
      const row=catalog[id], owner=reader.activeMain(id);
      if(!plain(row) || row.id!==id || !owner || owner.rawId!==id || owner.title!==row.cardTitle ||
          typeof row.title!=='string' || !row.title.trim() || typeof row.description!=='string') throw new Error('转发素材没有对应的活动主卡');
      const name='covers/'+id+'.png',file=join(root,name),bytes=checkedFile(file);
      if(bytes.subarray(0,8).toString('hex')!=='89504e470d0a1a0a') throw new Error('封面必须是 PNG');
      const digest=sha256(bytes);
      inventory.push([name,digest]);
      materials.set(id,{title:row.title,description:row.description,cover:{file,digest}});
    }
  }
  return {
    digest:sha256(JSON.stringify(inventory)),
    get({rawId,title}) {return materials.get(rawId) ?? {title:[...title].slice(0,64).join(''),description:''};},
  };
}

export function verifiedShareCover({file,digest}) {
  try {
    const bytes=checkedFile(file);
    if(sha256(bytes)!==digest) throw new Error();
    return {type:'image/png',bytes};
  } catch {throw Object.assign(new Error('转发封面与核准版本不符'),{code:'share_unavailable'});}
}
