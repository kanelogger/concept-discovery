import { lstatSync, readFileSync } from 'node:fs';
import { join, posix } from 'node:path';
import { canonical, fail, hash } from '../lib/siyuan.mjs';
import { describeLifecyclePatch } from './card-lifecycle-git.mjs';
import { inspectShareMaterials, stageShareRemoval } from './card-lifecycle-materials.mjs';
import { planCardRawChange } from './raw-lifecycle-plan.mjs';

const quoteArgument = value => "'" + value.replaceAll("'", "'\\''") + "'";

export const isOriginalCatalogue = path => path === 'raw/README.md' || /^raw\/[^/]+\/README\.md$/.test(path) ||
  path === 'raw/.sync.json' || path === 'server/share-materials/catalog.json';

function bindingDelta(before, after) {
  const changes = {};
  for (const group of ['cards','assets','readings']) {
    const old = before[group] ?? {}, next = after[group] ?? {};
    changes[group] = [...new Set([...Object.keys(old),...Object.keys(next)])].sort()
      .filter(key => hash(canonical(old[key] ?? null)) !== hash(canonical(next[key] ?? null)))
      .map(key => [key,old[key] ?? null,next[key] ?? null]);
  }
  const remaining = new Set((after.relations ?? []).map(item => hash(canonical(item))));
  changes.removedRelations = (before.relations ?? []).map(item => hash(canonical(item))).filter(id => !remaining.has(id)).sort();
  return {identity:before.identity,changes};
}

// Shared catalogues may already contain another card's staged removal. Bind
// the target's change, while the local planner preserves unrelated entries.
function stepIdentity(tree, file, edits, rawId) {
  const {path} = file;
  if (!isOriginalCatalogue(path)) return file;
  const before = readFileSync(join(tree,path),'utf8');
  const after = edits.get(path).toString('utf8');
  if (path === 'raw/.sync.json') return {path,delta:bindingDelta(JSON.parse(before),JSON.parse(after))};
  if (path === 'server/share-materials/catalog.json') return {path,entry:JSON.parse(before)[rawId]};
  // The planner changes only derived counts in the top-level overview. In
  // discipline catalogues it removes the one-line link(s) to this article.
  if (path === 'raw/README.md') return {path};
  const counts = new Map();
  for (const line of after.split('\n')) counts.set(line,(counts.get(line) ?? 0)+1);
  const removed = before.split('\n').filter(line => {
    const count = counts.get(line) ?? 0;
    if (count) counts.set(line,count-1);
    return !count;
  });
  return {path,removed};
}

/** Build the same frozen change from the owner's checkout and the observed main tree. */
export function planManualOriginal({tree, rawId, documentId, sourcePath}) {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(rawId ?? '') ||
      !/^\d{14}-[a-z0-9]{7}$/.test(documentId ?? '') ||
      typeof sourcePath !== 'string' || !/^[^/]+\/[^/]+\/article\.md$/.test(sourcePath) ||
      /[\\\x00-\x1f\x7f]/.test(sourcePath) || sourcePath.split('/').some(part => part === '.' || part === '..'))
    fail('outside_scope', '无法核实待删除原稿的路径或卡片身份。');
  for (const dir of ['raw','server','server/share-materials']) {
    const entry=lstatSync(join(tree,dir),{throwIfNoEntry:false});
    if (entry && !entry.isDirectory()) fail('outside_scope','原稿与分享素材必须位于项目的普通目录。');
  }
  const plan = planCardRawChange({rawRoot:join(tree,'raw'), rawId, action:'purge', sourcePath, documentIds:[documentId]});
  const blockers = [...plan.blockers];
  if (plan.packagePath && plan.packagePath !== sourcePath) blockers.push({reason:'original_path_unverified'});
  const edits = new Map();
  if (!blockers.length) {
    for (const [path,bytes] of plan.edits) edits.set('raw/'+path,bytes);
    const materials = inspectShareMaterials(join(tree,'server/share-materials'),rawId);
    for (const [path,bytes] of stageShareRemoval(tree,rawId,materials.fingerprint)) edits.set(path,bytes);
  }
  const files = describeLifecyclePatch(tree,edits);
  const moves = plan.moves;
  const steps = files.map(file => stepIdentity(tree,file,edits,rawId));
  const digest = hash(canonical({version:1,rawId,documentId,sourcePath,steps,moves:[...moves].sort()}));
  const prefix = 'raw/' + posix.dirname(sourcePath) + '/';
  const paths = files.filter(file => file.path.startsWith(prefix) && file.after === null).map(file => file.path);
  // A missing article can still have verified bindings or a dedicated share cover.
  if (!paths.length) paths.push(...files.map(file => file.path));
  const command = files.length && !blockers.length ? 'node scripts/remove-card-original.mjs ' +
    [rawId,documentId,sourcePath,digest].map(quoteArgument).join(' ') : null;
  return {edits,moves,blockers,files,paths,digest,command};
}
