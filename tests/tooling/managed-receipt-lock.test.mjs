import assert from 'node:assert/strict';
import test from 'node:test';
import { managedReceiptLockPath } from '../../scripts/raw-connection.mjs';

test('内核初始化前后的回执目录都按已核实的容器卷解释', () => {
  assert.equal(managedReceiptLockPath(),'/state/operations/managed-rpc.lock');
  assert.equal(managedReceiptLockPath('operations'),'/state/operations/managed-rpc.lock');
  assert.equal(managedReceiptLockPath('/state/operations'),'/state/operations/managed-rpc.lock');
  for (const path of ['/var/lib/operations','..','/state/../operations','/state'])
    assert.throws(()=>managedReceiptLockPath(path),/目标卷/);
});
