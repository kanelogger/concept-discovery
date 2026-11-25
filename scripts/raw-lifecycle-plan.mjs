import { posix } from 'node:path';
import { fromMarkdown } from 'mdast-util-from-markdown';
import { loadRawTree, rewriteRawAssetPaths, setRawArchive } from '../lib/raw-format.mjs';
import { hash } from '../lib/siyuan.mjs';
import { baseline } from './raw-sync.mjs';

const dirname = posix.dirname;
const relativePath = (base, destination) => {
  if (destination.startsWith('/') || /^[a-z][a-z\d+.-]*:/i.test(destination)) return null;
  try { return posix.join(dirname(base), decodeURIComponent(destination.split(/[?#]/, 1)[0])).normalize('NFC'); }
  catch { return null; }
};

function catalogueEdits(tree, target, edits, blockers) {
  const counts = new Map();
  for (const [path, bytes] of tree.files) {
    if (!/^[^/]+\/README\.md$/.test(path)) continue;
    const markdown = bytes.toString('utf8');
    const lines = markdown.split(/(?<=\n)/);
    const removed = new Set();
    function visit(node, item) {
      const listItem = node.type === 'listItem' ? node : item;
      if (node.type === 'link' && relativePath(path, node.url) === target.path) {
        if (listItem && listItem.position.start.line === listItem.position.end.line &&
            listItem.children.length === 1 && listItem.children[0].children?.length === 1) removed.add(listItem.position.start.line - 1);
        else blockers.push({ path, reason:'catalogue_reference' });
      }
      for (const child of node.children ?? []) visit(child, listItem);
    }
    visit(fromMarkdown(markdown));
    if (removed.size) {
      edits.set(path, Buffer.from(lines.filter((_, index) => !removed.has(index)).join('')));
      counts.set(path, removed.size);
    }
  }
  const overview = tree.files.get('README.md');
  if (!overview || !counts.size) return;
  const markdown = overview.toString('utf8');
  const total = [...counts.values()].reduce((sum, count) => sum + count, 0);
  const changed = markdown.replace(/(学科导读共收录 )(\d+)( 张知识卡)/, (_, before, count, after) =>
    `${before}${Math.max(0, Number(count) - total)}${after}`).replace(
    /^(\| \[[^\]\n]+\]\(<([^<>\n]+)>\) \| )(\d+)( \|)$/gm, (line, before, path, count, after) =>
      counts.has(path) ? `${before}${Math.max(0, Number(count) - counts.get(path))}${after}` : line);
  if (changed !== markdown) edits.set('README.md', Buffer.from(changed));
}

/** Computes a patch for a verified Git snapshot. No files are written here. */
export function planCardRawChange({ rawRoot, rawId, action, archivedAt, sourcePath, documentIds = [] }) {
  const tree = loadRawTree(rawRoot, {references:action === 'purge'});
  const target = tree.byId.get(rawId), edits = new Map(), blockers = [], moves = new Map();
  if (target?.metadata.kind === 'source') blockers.push({ path:target.path, reason:'not_a_card' });
  if (blockers.length) return { edits, blockers, moves };
  if (action !== 'purge') {
    if (!['archive', 'mark-archive', 'restore'].includes(action)) throw new Error('未知原稿操作。');
    if (!target) blockers.push({ reason:'raw_missing' });
    else {
      if (action !== 'restore' && (typeof archivedAt !== 'string' || !Number.isFinite(Date.parse(archivedAt))))
        throw new Error('归档需要明确时间。');
      const original = tree.files.get(target.path);
      const updated = setRawArchive(original, action === 'restore' ? null : archivedAt);
      if (!updated.equals(original)) edits.set(target.path, updated);
    }
    return { edits, blockers, moves };
  }

  const bindingsFile = '.sync.json';
  const bindings = tree.files.has(bindingsFile) ? baseline(JSON.parse(tree.files.get(bindingsFile).toString('utf8'))) : null;
  const binding = Object.hasOwn(bindings?.cards ?? {}, rawId) ? bindings.cards[rawId] : null;
  const packagePath = target?.path ?? sourcePath ?? binding?.path;
  if ((sourcePath !== undefined || packagePath !== undefined) && (!packagePath || typeof packagePath !== 'string' ||
      !/^[^/]+\/[^/]+\/article\.md$/.test(packagePath) || /[\\\x00-\x1f]/.test(packagePath) ||
      packagePath.split('/').some(part=>part === '.' || part === '..') ||
      (!target && tree.byPath.has(packagePath)) ||
      (binding?.path && binding.path !== packagePath))) {
    blockers.push({reason:'original_path_unverified'});
    return {edits,blockers,moves,rawMissing:!target};
  }
  const prefix = packagePath?.endsWith('/article.md') ? `${dirname(packagePath)}/` : null;
  const readings = new Map(tree.cards.flatMap(card => card.readings.map(reading => [reading.path, card])));
  const references = path => [...(tree.inbound.get(path) ?? [])].filter(base => !prefix || !base.startsWith(prefix)).sort();
  const rewrite = new Map();
  if (target) {
    for (const path of [target.path, ...target.readings.map(reading => reading.path)]) {
      if (!path.startsWith(prefix)) blockers.push({ path, reason:'reading_outside_package' });
      for (const source of references(path)) blockers.push({ path:source, target:path, reason:'incoming_reference' });
    }
  }
  if (prefix) catalogueEdits(tree, {path:packagePath}, edits, blockers);
  for (const [path, bytes] of tree.files) {
    if (!prefix || !path.startsWith(prefix)) continue;
    if (path === target?.path || target?.readings.some(reading => reading.path === path)) {
      edits.set(path, null);
      continue;
    }
    if (!tree.assets.has(path)) {
      blockers.push({ path, reason:'asset_ownership_unverified' });
      continue;
    }
    const users = references(path);
    if (users.length) {
      const owner = tree.byPath.get(users[0]) ?? readings.get(users[0]);
      if (!owner) { blockers.push({ path, reason:'asset_owner_unverified' }); continue; }
      const targetPath = `${dirname(owner.path)}/assets/shared-${hash(bytes)}${posix.extname(path).toLowerCase()}`;
      const existing = tree.files.get(targetPath) ?? edits.get(targetPath);
      if (existing && !existing.equals(bytes)) { blockers.push({ path, reason:'asset_destination_conflict' }); continue; }
      if (!existing) edits.set(targetPath, bytes);
      moves.set(path, targetPath);
      for (const user of users) {
        if (!rewrite.has(user)) rewrite.set(user, new Map());
        rewrite.get(user).set(path, targetPath);
      }
    }
    edits.set(path, null);
  }
  for (const [path, destinations] of rewrite) edits.set(path, rewriteRawAssetPaths(tree, path, destinations));

  if (bindings) {
    const ids = new Set([rawId, target?.metadata.siyuan_id, binding?.remoteId, binding?.legacyId, ...documentIds].filter(Boolean));
    const original = JSON.stringify(bindings);
    if (binding) delete bindings.cards[rawId];
    if (prefix) {
      for (const group of [bindings.readings, bindings.assets]) {
        for (const path of Object.keys(group ?? {})) {
          if (path.startsWith(prefix) && !tree.files.has(path)) delete group[path];
        }
      }
    }
    for (const path of edits.keys()) {
      if (edits.get(path) !== null) continue;
      if (Object.hasOwn(bindings.readings ?? {}, path)) delete bindings.readings[path];
      if (Object.hasOwn(bindings.assets ?? {}, path)) {
        const destination = moves.get(path);
        if (destination && !bindings.assets[destination]) bindings.assets[destination] = bindings.assets[path];
        delete bindings.assets[path];
      }
    }
    if (Array.isArray(bindings.relations)) {
      bindings.relations = bindings.relations.filter(relation => !ids.has(relation.source_concept_id) && !ids.has(relation.target_concept_id));
    }
    if (JSON.stringify(bindings) !== original) edits.set(bindingsFile, Buffer.from(JSON.stringify(bindings, null, 2) + '\n'));
  }
  return { edits, moves, blockers, rawMissing:!target, packagePath };
}
