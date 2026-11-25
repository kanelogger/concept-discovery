import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { execute } from "../../lib/commands.mjs";
import { save, Siyuan } from "../../lib/siyuan.mjs";

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "cd-status-"));
  t.after(() => rmSync(root, {recursive: true, force: true}));
  const dataDir = join(root, "operations");
  const api = new Siyuan({url: "http://localhost", dataDir, token: "synthetic"});
  api.identity = async () => "library";
  return {api, dataDir, status: op_id => execute(api, "operation-status", {op_id})};
}

function verifiedSave() {
  const result = {id:"doc", revision:"saved"};
  return {target:"library", command:"save-document", documentId:result.id, state:"verified",
    recoveryRevision:result.revision, recoverySignature:"native", afterRevision:result.revision,
    afterSignature:"native", result};
}

test("只读进程能查询已核实和普通失败的回执，保留已有结果和错误", t => {
  const {dataDir} = fixture(t);
  const success = verifiedSave(), result = success.result;
  const error = {code: "content_conflict", message: "内容已改变"};
  save(join(dataDir, "success.json"), success);
  save(join(dataDir, "failure.json"), {target: "library", command: "save-document", state: "failed", error});
  save(join(dataDir, "foreign.json"), {target: "other", command: "save-document", state: "verified", result});
  save(join(dataDir, "conversion.json"), {target: "library", command: "raw-convert-document", state: "failed"});

  save(join(dataDir, "interrupted-conversion.json"), {target:"library", command:"raw-convert-document",
    state:"unknown", documentId:"card", recoveryRevision:"observed", recoverySignature:"observed native"});
  save(join(dataDir, "old-conversion.json"), {target:"library", command:"raw-convert-document",
    state:"verified", documentId:"card", afterRevision:"observed later", result:{id:"card", revision:"observed later"}});
  save(join(dataDir, "old-save.json"), {target:"library", command:"save-document", state:"verified",
    documentId:result.id, recoveryRevision:result.revision, afterRevision:result.revision,
    afterSignature:"observed later", result});
  const run = spawnSync(process.execPath, ["--permission", "--allow-fs-read=*", "--input-type=module", "-e", `
    import assert from "node:assert/strict";
    import {writeFileSync} from "node:fs";
    import {join} from "node:path";
    import {execute} from "./lib/commands.mjs";
    import {Siyuan} from "./lib/siyuan.mjs";
    const dataDir = process.argv[1];
    assert.throws(() => writeFileSync(join(dataDir, "write-probe"), ""), {code: "ERR_ACCESS_DENIED"});
    const api = new Siyuan({url: "http://localhost", dataDir, token: "synthetic"});
    api.identity = async () => "library";
    const status = op_id => execute(api, "operation-status", {op_id});
    const recorded = [await status("success"), await status("failure")];
    await assert.rejects(status("foreign"), {code: "operation_conflict"});
    await assert.rejects(status("../bad"), {code: "invalid_input"});
    assert.equal((await status("conversion")).state, "failed");
    const historical = await status("old-conversion");
    assert.equal(historical.state, "unknown");
    assert.equal(historical.error.code, "unproven_conversion");
    const saved = await status("old-save");
    assert.equal(saved.state, "unknown");
    assert.equal(saved.result, undefined);
    assert.equal(saved.recovery_revision, undefined);
    await assert.rejects(status("interrupted-conversion"), {code: "ERR_ACCESS_DENIED"});
    console.log(JSON.stringify(recorded));
  `, dataDir], {encoding: "utf8", cwd: new URL("../../", import.meta.url)});
  assert.equal(run.status, 0, run.stderr);
  assert.deepEqual(JSON.parse(run.stdout), [
    {op_id: "success", state: "verified", result},
    {op_id: "failure", state: "failed", error}
  ]);
});

test("可写实例的只读查询不创建回执目录或临时锁", async t => {
  const {dataDir, status} = fixture(t);
  await assert.rejects(status("missing"), {code: "operation_conflict"});
  await assert.rejects(status("../bad"), {code: "invalid_input"});
  assert.equal(existsSync(dataDir), false);

  save(join(dataDir, "done.json"), verifiedSave());
  // An ephemeral create/unlink would also advance the directory timestamp.
  utimesSync(dataDir, 1, 1);
  assert.equal((await status("done")).state, "verified");
  assert.equal(statSync(dataDir).mtimeMs, 1000);
});

test("初读未决回执后，查询以锁内重新读到的结果和所属实例为准", async t => {
  const {api, dataDir, status} = fixture(t);
  const path = join(dataDir, "operation.json");
  const pending = {target: "library", command: "update-block", blockId: "block", state: "unknown"};
  let replacement;
  const withReceipt = api.withReceipt.bind(api);
  t.mock.method(api, "withReceipt", (...args) => {
    save(path, replacement);
    return withReceipt(...args);
  });
  api.markdown = () => assert.fail("不应确认旧回执");

  save(path, pending);
  replacement = {...pending, state: "verified", result: {id: "new"}};
  assert.deepEqual((await status("operation")).result, {id: "new"});
  save(path, pending);
  replacement = {...pending, target: "other"};
  await assert.rejects(status("operation"), {code: "operation_conflict"});

  save(path, pending);
  replacement = {...verifiedSave(), afterSignature:"other signature"};
  api.sql = api.inScope = () => assert.fail("证据矛盾的历史完成回执不能用当前文档重新确认");
  assert.equal((await status("operation")).error.code, "unproven_document_write");
  assert.deepEqual(JSON.parse(readFileSync(path, "utf8")), replacement);
});
