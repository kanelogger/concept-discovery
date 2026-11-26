import { createHash } from 'node:crypto';
import { closeSync, constants, fstatSync, lstatSync, openSync, readFileSync, readSync } from 'node:fs';
import { join } from 'node:path';

const digest = /^[0-9a-f]{64}$/;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const publicId = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function requireApproval(condition, message) {
  if (!condition) throw Object.assign(new Error(message), {code:'content_unavailable'});
}

function withRecord(directory, name, read) {
  const fd = openSync(join(directory,name), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const stat = fstatSync(fd);
    requireApproval(stat.isFile() && stat.nlink===1, '核准记录必须是独立普通文件');
    return read(fd,stat.size);
  } finally {
    closeSync(fd);
  }
}

function readPinned(directory, name, expected) {
  requireApproval(typeof expected==='string' && digest.test(expected), '缺少独立核实的核准摘要');
  const bytes = withRecord(directory,name,fd=>readFileSync(fd));
  requireApproval(createHash('sha256').update(bytes).digest('hex')===expected, '当前核准记录的摘要已变化');
  return bytes;
}

function currentRecords({controlDirectory,checkpointSha256,libraryId}) {
  requireApproval(typeof libraryId==='string' && libraryId.trim() && lstatSync(controlDirectory).isDirectory(),
    '缺少当前库身份或独立控制目录');
  const readCheckpoint = () => readPinned(controlDirectory,'checkpoint.json',checkpointSha256);
  const checkpointBytes = readCheckpoint();
  const checkpoint = JSON.parse(checkpointBytes);
  requireApproval(checkpoint.version===1 && checkpoint.libraryId===libraryId &&
    Number.isSafeInteger(checkpoint.generation) && checkpoint.generation>0, '当前核准检查点的版本或库身份不符');
  const approved = readPinned(controlDirectory,'approved.json',checkpoint.approvedSha256);
  const deletions = readPinned(controlDirectory,'deletions.json',checkpoint.deletionsSha256);
  // Catch an atomic change of checkpoint while reading its referenced files.
  readCheckpoint();
  return {checkpoint,checkpointBytes,approved,deletions};
}

// Reopen each name and compare its current bytes with the pinned copy. A
// listener owns one scratch buffer, and the synchronous comparisons cannot interleave.
function recheckRecords(directory, records, scratch) {
  requireApproval(lstatSync(directory).isDirectory(), '缺少独立控制目录');
  function compare(name, expected) {
    withRecord(directory,name,(fd,size)=>{
      requireApproval(size===expected.length, '核准记录的长度已变化');
      let offset = 0;
      while (offset < size) {
        const count = readSync(fd,scratch,0,Math.min(scratch.length,size-offset),null);
        requireApproval(count>0 && scratch.compare(expected,offset,offset+count,0,count)===0, '核准记录已变化');
        offset += count;
      }
      requireApproval(readSync(fd,scratch,0,1,null)===0, '核准记录的长度已变化');
    });
  }
  compare('checkpoint.json',records.checkpointBytes);
  compare('approved.json',records.approved);
  compare('deletions.json',records.deletions);
  compare('checkpoint.json',records.checkpointBytes);
}

function idList(ids) {
  return Array.isArray(ids) && ids.every(id=>typeof id==='string' && publicId.test(id)) && new Set(ids).size===ids.length;
}

function validAuth(value) {
  return typeof value?.volumeId==='string' && uuid.test(value.volumeId) &&
    typeof value.generation==='string' && uuid.test(value.generation);
}

function parseRecords({checkpoint,approved,deletions}, state) {
  const approval = JSON.parse(approved);
  const ledger = JSON.parse(deletions);
  requireApproval(approval.version===1 && approval.libraryId===checkpoint.libraryId &&
    approval.generation===checkpoint.generation && approval.state===state, '本库当前核准状态或代次不符');
  requireApproval(ledger.version===1 && ledger.libraryId===checkpoint.libraryId && idList(ledger.deletedIds),
    '当前永久删除记录的库身份或公开 ID 无效');
  requireApproval(validAuth(approval.authIdentity) || (state==='closed' && approval.authIdentity===null),
    '当前核准缺少有效的认证卷标识');
  return {approval,deletedIds:ledger.deletedIds};
}

export function readClosedContentApproval(options) {
  const {approval,deletedIds} = parseRecords(currentRecords(options),'closed');
  const {libraryId,generation,authIdentity} = approval;
  return {libraryId,generation,authIdentity,deletedIds};
}

function verifyCandidate({libraryId,manifestSha256,reader,authIdentity,materialDigest}, approval, deletedIds) {
  const inventory = reader.inventory();
  requireApproval(inventory.libraryId===libraryId && approval.readerContract===inventory.readerContract &&
    Number.isSafeInteger(approval.readerContract) && approval.readerContract>0, '程序的读取契约与核准版本不符');
  requireApproval(typeof manifestSha256==='string' && digest.test(manifestSha256) &&
    manifestSha256===inventory.manifestSha256 && manifestSha256===approval.manifestSha256,
    '核准的内容包与当前读取的版本不符');
  requireApproval(typeof materialDigest==='string' && digest.test(materialDigest) && materialDigest===approval.materialDigest,
    '核准的分享素材与当前挂载不符');
  requireApproval(validAuth(authIdentity) && authIdentity.volumeId===approval.authIdentity.volumeId &&
    authIdentity.generation===approval.authIdentity.generation, '核准的认证卷或恢复代次不符');
  requireApproval(idList(approval.activeIds) && idList(approval.archivedIds), '活动或归档主卡清单无效');
  const active = new Set(inventory.activeIds);
  requireApproval(active.size===approval.activeIds.length && approval.activeIds.every(id=>active.has(id)),
    '活动主卡的公开 ID 集合与核准不符');
  const publicRefs = new Set([...active,...inventory.publicRefs]);
  const reserved = new Set(inventory.reservedMainIds);
  const historicalRefs = new Set(inventory.reservedRefs);
  const deleted = new Set(deletedIds);
  requireApproval(approval.archivedIds.every(id=>reserved.has(id) && !deleted.has(id) && !publicRefs.has(id)) &&
    deletedIds.every(id=>!publicRefs.has(id) && (!historicalRefs.has(id) || reserved.has(id))),
    '归档或永久删除的身份仍可访问或归属冲突');
}

// The independently supplied checkpoint pin is deliberately immutable for the
// life of the listener. A closed or superseded listener requires a fresh start.
export function openContentApproval(input) {
  const options = {...input, authIdentity:{...input.authIdentity}};
  const scratch = Buffer.allocUnsafe(16 * 1024);
  let records, verified, failure;
  function assertReady() {
    if (failure) throw failure;
    try {
      if (!verified) {
        records = currentRecords(options);
        verified = parseRecords(records,'open');
        verifyCandidate(options,verified.approval,verified.deletedIds);
      } else recheckRecords(options.controlDirectory,records,scratch);
      // Auth is the only writable volume. Recheck it even when the signed-off
      // content and the owner-controlled files still match the pinned bytes.
      requireApproval(typeof options.verifyAuth==='function', '缺少认证卷和永久删除清理回执核对');
      const result = options.verifyAuth(verified.approval.authIdentity,verified.deletedIds);
      requireApproval(result===undefined || result===true, '认证卷未通过同步核对');
    } catch (error) {
      // This goes through the public HTTP error handler. Keep filesystem paths
      // and private auth diagnostics in the local cause.
      failure = Object.assign(new Error('内容发布尚未通过当前核准',{cause:error}), {code:'content_unavailable'});
      throw failure;
    }
  }
  return {assertReady,ready() {
    try { assertReady(); return true; }
    catch { return false; }
  }};
}
