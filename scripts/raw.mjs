import { parseArgs } from 'node:util';
import { readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { connectRaw } from './raw-connection.mjs';

const usage = `npm run raw -- check                         校验原稿、引用和本地材料
npm run raw -- sync --dry-run                预览与当前库的差异
npm run raw -- sync                          导入并核对；中断后重新运行原命令
npm run raw -- sync --settle                 核实未完成批次的回执，保留已写项并列出待处理项
npm run raw -- rebase <英文标识> --revision <完整修订号>  接受核对过的数据库版本作为下次写入基线
npm run raw -- archive <英文标识>             显式归档一张已绑定的卡
npm run raw -- archives                      核对原稿、实例绑定与归档回执
npm run raw -- status <操作ID>                在本地核对操作回执
npm run raw -- recover <操作ID> --revision <写后修订或哈希>  按原回执受保护地恢复
npm run raw -- export <全新目录>               从当前库导出一份独立原稿

可选参数：--raw-root <原稿目录>、--private-root <知识库私有目录>、--json。
默认目录为仓库的 raw 和 .local/knowledge。只读 check 可以离线运行。`;
const repo = fileURLToPath(new URL('../', import.meta.url));
function summarize(plan) {
  const counts = {};
  for (const action of plan.actions) counts[action.method] = (counts[action.method] ?? 0) + 1;
  return { actions: plan.actions.length, counts, changes: plan.actions.map(({ method, key }) => ({ method, key })),
    ...(plan.assetMoves?.length && {assetMoves:plan.assetMoves}),
    unchanged: plan.unchanged, missing: plan.missing, conflicts: plan.conflicts };
}
async function main() {
  const { positionals, values } = parseArgs({ allowPositionals:true, options:{
    'raw-root':{type:'string'}, 'private-root':{type:'string'}, 'dry-run':{type:'boolean'}, settle:{type:'boolean'}, revision:{type:'string'},
    ledger:{type:'string'}, models:{type:'string'}, 'asset-corrections':{type:'string'},
    'git-only':{type:'boolean'}, json:{type:'boolean'}, help:{type:'boolean', short:'h'}
  } });
  if (values.help || !positionals.length) { console.log(usage); return; }
  const [command, rawId] = positionals;
  if (!['check','sync','archive','archives','export','rebase','recover','status'].includes(command) || positionals.length !== (['archive','export','rebase','recover','status'].includes(command) ? 2 : 1) ||
      (values['git-only'] && command !== 'archives') ||
      ((values['dry-run'] || values.settle) && command !== 'sync') || (values.settle && values['dry-run']) ||
      (['rebase','recover'].includes(command) !== Boolean(values.revision)) || (Boolean(values.models) !== Boolean(values.ledger)) ||
      ((values.ledger || values['asset-corrections']) && command !== 'export')) throw new Error(usage);
  const rawRoot = resolve(values['raw-root'] ?? join(repo,'raw'));
  const print = data => console.log(JSON.stringify(data,null,values.json ? undefined : 2));
  if (command === 'check') {
    const { loadRawTree } = await import('../lib/raw-format.mjs');
    const tree = loadRawTree(rawRoot);
    print({ cards:tree.cards.length, sources:tree.sourceFiles.size, sourceFolders:tree.sources.length,
      readings:tree.readingPaths.size, assets:tree.assets.size, valid:true });
    return;
  }
  const { selectRawSyncPlan, applyRawSync, archiveRawCard, listRawArchives, settleRawSync, rebaseRawCard, recoverRawOperation } = await import('./raw-sync.mjs');
  if (command === 'archives' && values['git-only']) {
    print(await listRawArchives({rawRoot}));
    return;
  }
  const conn = connectRaw(resolve(values['private-root'] ?? join(repo,'.local/knowledge')));
  try {
    const stateDir = join(conn.root,'raw-sync');
    if (command === 'status' || command === 'recover') {
      const identity = await conn.rpc('raw-target');
      print(command === 'status' ? await conn.rpc('raw-status',{identity,op_id:rawId}) :
        await recoverRawOperation({stateDir,identity,backupOp:rawId,revision:values.revision,rpc:conn.rpc}));
      return;
    }
    const target = {rawRoot, stateDir, rpc: conn.rpc};
    if (command === 'archives') {
      print(await listRawArchives(target));
      return;
    }
    if (command === 'archive') {
      print(await archiveRawCard({...target, rawId}));
      return;
    }
    if (command === 'sync' && !values.settle) {
      const {plan, pending} = await selectRawSyncPlan(target);
      if (values['dry-run'] || plan.conflicts.length) {
        print({project:conn.project, pending, ...summarize(plan)});
        if (plan.conflicts.length) process.exitCode = 1;
      } else {
        print(await applyRawSync({plan, stateDir, rpc:conn.rpc}));
      }
      return;
    }
    const inventory = await conn.rpc('inventory', { withBlocks:command === 'export' });
    if (command === 'export') {
      const { exportInventory, readExportCatalog } = await import('./raw-export.mjs');
      const catalog = values.ledger && await readExportCatalog(values.ledger,values.models);
      const origin = JSON.parse(readFileSync(join(conn.root,'service.json'),'utf8')).publicUrl;
      const assetCorrections = values['asset-corrections'] && JSON.parse(readFileSync(values['asset-corrections'],'utf8'));
      print(await exportInventory({ inventory,catalog,assetsDir:join(conn.root,'workspace/data/assets'),
        outputDir:resolve(rawId),origin,assetCorrections }));
      return;
    }
    const context = { ...target, inventory };
    if (values.settle) {
      const result = await settleRawSync(context);
      print(result);
      if (result.pending || result.conflicts?.length) process.exitCode = 1;
      return;
    }
    if (command === 'rebase') {
      print(await rebaseRawCard({ ...context, rawId, revision:values.revision }));
      return;
    }
  } finally { await conn.close(); }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
