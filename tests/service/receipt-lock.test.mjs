import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { execute } from "../../lib/commands.mjs";
import { Documents } from "../../lib/documents.mjs";
import { rawWrite } from "../../lib/raw-write.mjs";
import { canonical, hash, save, Siyuan } from "../../lib/siyuan.mjs";

const identity = "synthetic-library";
const id = "20260101010101-0000001";

function fixture(t) {
  const dataDir = mkdtempSync(join(tmpdir(), "cd-receipt-"));
  t.after(() => rmSync(dataDir, {recursive: true, force: true}));
  const client = () => {
    const api = new Siyuan({dataDir, url: "http://localhost", token: "synthetic"});
    api.identity = async () => identity;
    return api;
  };
  const writer = client(), reader = client();
  return {
    writer, reader, lock: join(dataDir, "write.lock"),
    status: op_id => execute(reader, "operation-status", {op_id}),
    outcome: request => rawWrite(reader, "raw-outcome", {identity, method: "raw-document", request}),
    record(command, input, fields = {}) {
      const path = join(dataDir, input.op_id + ".json");
      save(path, {command, input, target: identity, requestHash: hash(canonical({command, input, target: identity})),
        state: "unknown", ...fields});
      return path;
    }
  };
}

test("写者先获得锁时，旧块和创建操作仅返回已落盘状态", async t => {
  const f = fixture(t);
  for (const command of ["update-block", "create"]) {
    const input = {op_id: "active-" + command};
    const started = Promise.withResolvers(), finish = Promise.withResolvers();
    const writing = f.writer.operate(command, input, async (rec, persist) => {
      Object.assign(rec, command === "create" ? {documentId: id} : {blockId: id, intended: "写入中"});
      persist();
      started.resolve(rec.requestHash);
      await finish.promise;
      return {id, op_id: input.op_id};
    });
    const requestHash = await started.promise;
    let reads = 0;
    f.reader.markdown = async () => { reads++; return "写入中"; };
    f.reader.attrs = async () => { reads++; return {"custom-cd-complete": "1", "custom-cd-request": requestHash}; };
    try {
      assert.equal((await f.status(input.op_id)).state, "prepared");
      assert.equal((await f.reader.receipt(input.op_id)).value.state, "prepared");
      assert.equal(reads, 0);
    } finally { finish.resolve(); await writing; }
    assert.equal((await f.status(input.op_id)).state, "verified");
  }
});

test("核对者先获得锁时，迟到的读回不能覆盖新写者的结果", async t => {
  const f = fixture(t), input = {op_id: "late-block"};
  f.record("update-block", input, {blockId: id, intended: "旧值", recoveryRevision: "原恢复修订"});
  const started = Promise.withResolvers(), finish = Promise.withResolvers();
  f.reader.markdown = async () => { started.resolve(); return finish.promise; };
  const checking = f.status(input.op_id);
  await started.promise;
  let writes = 0;
  const write = () => f.writer.operate("update-block", input, async () => {
    writes++; return {id, markdown: "新值"};
  }, {retryRecovery: true});
  try {
    await assert.rejects(write(), {code: "write_locked"});
    const busy = await f.status(input.op_id);
    assert.equal(busy.state, "unknown");
    assert.equal(busy.recovery_revision, "原恢复修订");
  } finally {
    finish.resolve("旧值");
    await checking;
  }
  assert.equal((await write()).markdown, "旧值");
  assert.equal(writes, 0);
});

test("批次结算在写锁期间保留尚无回执的操作", async t => {
  const f = fixture(t), request = {identity, op_id: "new-operation"};
  writeFileSync(f.lock, "", {flag: "wx"});
  assert.deepEqual(await f.outcome(request), {state: "pending", op_id: request.op_id, recoveryRevision: null});
  rmSync(f.lock);
  assert.deepEqual(await f.outcome(request), {state: "unstarted"});
});

test("结算核对原状的整个快照期间排斥写者", async t => {
  const f = fixture(t), request = {identity, kind: "card", id, op_id: "settling"};
  f.record("raw-create-document", request, {documentId: id, beforeDocument: {signature: "before"}});
  const started = Promise.withResolvers(), finish = Promise.withResolvers();
  t.mock.method(Documents.prototype, "snapshot", async () => { started.resolve(); return finish.promise; });
  const settling = f.outcome(request);
  await started.promise;
  try {
    await assert.rejects(f.writer.operate("create", {op_id: "later"}, async () => ({id})), {code: "write_locked"});
  } finally { finish.resolve({id, signature: "before", revision: "restored"}); await settling; }
  assert.deepEqual(await settling, {state: "unstarted", restored: {id, revision: "restored"}});
});

test("核对异常释放锁，原块回执和旧创建回执仍能确认和重查", async t => {
  const f = fixture(t), input = {op_id: "old-block"};
  const path = f.record("update-block", input, {blockId: id, intended: "完整内容", input: undefined});
  const original = readFileSync(path);
  f.reader.markdown = async () => { assert.equal(existsSync(f.lock), true); throw new Error("readback failed"); };
  await assert.rejects(f.status(input.op_id), /readback failed/);
  assert.equal(existsSync(f.lock), false);
  assert.deepEqual(readFileSync(path), original);
  f.reader.markdown = async () => "完整内容";
  assert.deepEqual((await f.status(input.op_id)).result, {id, markdown: "完整内容", hash: hash("完整内容"), op_id: input.op_id});
  const verified = readFileSync(path);
  f.reader.markdown = async () => { throw new Error("unexpected readback"); };
  assert.equal((await f.status(input.op_id)).state, "verified");
  assert.deepEqual(readFileSync(path), verified);
  const create = {op_id: "old-create"};
  f.record("create", create, {documentId: id, input: undefined});
  const {requestHash} = (await f.reader.receipt(create.op_id)).value;
  f.reader.attrs = async () => ({"custom-cd-request": requestHash, "custom-cd-complete": "1"});
  assert.deepEqual((await f.status(create.op_id)).result, {id, op_id: create.op_id});
});

test("旧卡转换按同一请求、库和 schema 确认；状态、结算和重跑共用结果", async t => {
  const f = fixture(t);
  const request = {identity, kind: "card", legacy: true, id, title: "标题", markdown: "正文",
    op_id: "legacy", expected_revision: "before"};
  const backup = {signature: "before", revision: "before"};
  const path = f.record("raw-convert-document", request, {documentId: id, beforeDocument: backup,
    intendedTitle: request.title, intendedMarkdown: request.markdown, recoveryRevision: "partial", recoverySignature:"partial"});
  let schema = "1";
  // A separate attribute request may see another revision of this document.
  f.reader.attrs = async () => ({"custom-cd-schema": "2"});
  t.mock.method(Documents.prototype, "snapshot", async () => {
    assert.equal(existsSync(f.lock), true);
    return {id, title: request.title, markdown: request.markdown, raw: request.markdown,
      revision: "after", signature: "after", attrs: {"custom-cd-schema": schema}};
  });
  assert.equal((await f.status(request.op_id)).recovery_revision, "partial");
  assert.equal((await f.outcome(request)).state, "pending");
  await assert.rejects(rawWrite(f.reader, "raw-document", request), {code: "operation_pending"});
  schema = "2";
  // Same public content and converted schema do not identify the writer of a new revision.
  const partial = readFileSync(path);
  assert.equal((await f.status(request.op_id)).state, "unknown");
  assert.equal((await f.outcome(request)).state, "pending");
  await assert.rejects(rawWrite(f.reader, "raw-document", request), {code:"operation_pending"});
  assert.deepEqual(readFileSync(path), partial);
  // A separately recorded write-time observation still confirms all three entry points.
  save(path, {...JSON.parse(partial), recoveryRevision:"after", recoverySignature:"after"});
  const original = readFileSync(path);
  await assert.rejects(rawWrite(f.reader, "raw-document", {...request, title: "另一请求"}), {code: "operation_conflict"});
  await assert.rejects(f.outcome({...request, title: "另一请求"}), {code: "operation_conflict"});
  f.reader.identity = async () => "another-library";
  await assert.rejects(f.status(request.op_id), {code: "operation_conflict"});
  f.reader.identity = async () => identity;
  assert.deepEqual(readFileSync(path), original);
  const damaged = {...JSON.parse(original), requestHash: "different"};
  save(path, damaged);
  await assert.rejects(f.status(request.op_id), {code: "operation_conflict"});
  assert.deepEqual((await f.reader.receipt(request.op_id)).value, damaged);

  for (const firstCheck of [
    async () => assert.equal((await f.status(request.op_id)).state, "verified"),
    async () => assert.equal((await f.outcome(request)).result.revision, "after"),
    async () => assert.deepEqual(await rawWrite(f.reader, "raw-document", request), {id, revision: "after"})
  ]) {
    writeFileSync(path, original);
    await firstCheck();
    const receipt = (await f.reader.receipt(request.op_id)).value;
    assert.equal(receipt.state, "verified");
    assert.equal(receipt.afterRevision, "after");
    assert.deepEqual(receipt.beforeDocument, backup);
    assert.equal((await f.outcome(request)).result.revision, "after");
    assert.deepEqual(await rawWrite(f.reader, "raw-document", request), {id, revision: "after"});
  }
});

test("旧版错误晋升或缺少写端证据的转换回执不能授权重放、结算和恢复", async t => {
  const f = fixture(t);
  const currentRevision = hash("after independent edit"), writerRevision = hash("original capture");
  const request = {identity, kind:"card", legacy:true, id, title:"标题", markdown:"正文",
    op_id:"old-promotion", expected_revision:hash("original input")};
  const current = {id, title:request.title, markdown:request.markdown, raw:request.markdown,
    attrs:{"custom-cd-schema":"2","custom-user-note":"独立修改"}, revision:currentRevision, signature:"edited"};
  t.mock.method(Documents.prototype,"snapshot",async () => structuredClone(current));
  let mutations = 0;
  f.reader.api = async () => { mutations++; throw Error("unexpected native mutation"); };
  for (const captured of [writerRevision, undefined]) {
    const path = f.record("raw-convert-document",request,{state:"verified",documentId:id,
      beforeDocument:{id,signature:"before",revision:request.expected_revision},
      intendedTitle:request.title,intendedMarkdown:request.markdown, writeStarted:true,
      recoveryRevision:captured, afterRevision:currentRevision, afterHash:hash(request.markdown),
      afterSignature:current.signature, result:{id, revision:currentRevision}});
    const original = readFileSync(path);
    assert.equal((await f.status(request.op_id)).state, "unknown");
    assert.equal((await f.outcome(request)).state, "pending");
    await assert.rejects(rawWrite(f.reader, "raw-document",request), {code:"operation_pending"});
    await assert.rejects(rawWrite(f.reader,"raw-recover",{identity,op_id:"undo-"+String(Boolean(captured)),
      backup_op_id:request.op_id,expected_revision:currentRevision}),
      error => ["invalid_backup","content_conflict"].includes(error.code));
    f.reader.sql = async () => [];
    await assert.rejects(rawWrite(f.reader, "raw-order-readings", {identity, id, readings:[],
      op_id:"order-"+String(Boolean(captured)),expected_operation:request.op_id}), {code:"content_conflict"});
    assert.equal(mutations, 0);
    assert.deepEqual(readFileSync(path),original);
  }
});

test("修订相同时仍保留独立的原生块属性", async t => {
  const f = fixture(t), revision = hash("same revision");
  const input = {identity, id, kind:"card", legacy:true, title:"标题", markdown:"正文",
    op_id:"native-drift", expected_revision:hash("before")};
  const path = f.record("raw-convert-document", input, {documentId:id, beforeDocument:{id,signature:"old"},
    intendedTitle:input.title, intendedMarkdown:input.markdown, recoveryRevision:revision, recoverySignature:"writer"});
  const original = readFileSync(path);
  t.mock.method(Documents.prototype, "snapshot", async () => ({id, title:input.title, markdown:input.markdown,
    attrs:{"custom-cd-schema":"2"}, revision, signature:"independent native edit"}));
  assert.equal((await f.status(input.op_id)).state, "unknown");
  await assert.rejects(rawWrite(f.reader,"raw-recover",{identity,op_id:"undo-native-drift",
    backup_op_id:input.op_id,expected_revision:revision}), {code:"content_conflict"});
  assert.deepEqual(readFileSync(path), original);
});

test("旧保存和转换缺少写端签名时，同修订和事后签名都不能证明写入身份", async t => {
  for (const command of ["save-document", "raw-convert-document"]) {
    for (const [state, capturedRevision] of [["unknown", true], ["verified", true], ["verified", false]]) {
      const name = [command, state, capturedRevision ? "有写端修订" : "仅事后结果"].join(" ");
      await t.test(name, async t => {
        const f = fixture(t), revision = hash("same document revision");
        const input = {id, title:"标题", markdown:"相同正文", op_id:"old-document", expected_revision:hash("before")};
        const request = {...input, kind:"card", identity, legacy:command === "raw-convert-document"};
        const current = {id, title:input.title, markdown:input.markdown, raw:input.markdown, revision,
          signature:"edited child", attrs:{"custom-cd-schema":"2"}, nodes:[]};
        const fields = {state, documentId:id, beforeDocument:{id, title:"原题", markdown:"原文", raw:"原文", attrs:{},
          revision:input.expected_revision, signature:"before"},
          intendedTitle:input.title, intendedMarkdown:input.markdown, writeStarted:true};
        if (capturedRevision) fields.recoveryRevision = revision;
        // Historical confirmations could have recorded this exact independent child signature after the fact.
        if (state === "verified") Object.assign(fields, {afterRevision:revision, afterHash:hash(current.raw),
          afterSignature:current.signature, result:{id, revision}});
        const path = f.record(command, command === "save-document" ? input : request, fields);
        const original = readFileSync(path);
        t.mock.method(Documents.prototype, "snapshot", async () => structuredClone(current));
        f.reader.sql = async () => [];
        let writes = 0;
        f.reader.api = f.reader.setAttrs = async () => { writes++; };
        f.reader.flush = async () => {};
        await assert.rejects(rawWrite(f.reader,"raw-recover",{identity,op_id:"undo",backup_op_id:input.op_id,
          expected_revision:revision}), error => ["invalid_backup","content_conflict"].includes(error.code));
        const status = await f.status(input.op_id), outcome = await f.outcome(request);
        assert.equal(status.state, "unknown");
        assert.equal(status.recovery_revision, undefined);
        assert.equal(outcome.state, "pending");
        assert.equal(outcome.recoveryRevision ?? null, null);
        await assert.rejects(rawWrite(f.reader,"raw-document",request), {code:"operation_pending"});
        await assert.rejects(rawWrite(f.reader,"raw-order-readings",{identity,id,readings:[],op_id:"order",
          expected_operation:input.op_id}), {code:"content_conflict"});
        assert.equal(writes, 0);
        assert.deepEqual(readFileSync(path), original);
      });
    }
  }
});

test("原状可重试未开写的保存，但不能重写证据不足的历史完成回执", async t => {
  for (const [name, state, title] of [
    ["尚未开写", "prepared", "新标题"],
    ["独立恢复原状", "verified", "新标题"],
    ["原操作没有改动", "verified", "原标题"]
  ]) await t.test(name, async t => {
    const f = fixture(t);
    const before = {id, title:"原标题", markdown:"正文", raw:"正文", attrs:{}, editable:true,
      revision:hash("原标题"), signature:"原生原状", units:[{id:"paragraph", markdown:"正文"}]};
    const input = {id, title, markdown:before.markdown, expected_revision:before.revision, op_id:"old-save"};
    const request = {...input, kind:"card", identity};
    const path = f.record("save-document", input, {state, documentId:id, beforeDocument:before,
      intendedTitle:title, intendedMarkdown:before.markdown, writeStarted:state === "verified" && title !== before.title,
      ...(state === "verified" && {afterRevision:hash(title), afterSignature:"事后确认", result:{id, revision:hash(title)}})});
    const frozen = readFileSync(path);
    let current = before, writes = 0;
    t.mock.method(Documents.prototype, "snapshot", async () => structuredClone(current));
    f.reader.api = async (path, {title}) => {
      assert.equal(path, "/api/filetree/renameDocByID");
      writes++;
      current = {...before, title, revision:hash(title), signature:"新标题的原生签名"};
    };
    f.reader.flush = async () => {};
    const status = await f.status(input.op_id), outcome = await f.outcome(request);
    assert.deepEqual(readFileSync(path), frozen);
    const write = rawWrite(f.reader, "raw-document", request);
    if (state === "prepared") {
      assert.equal(status.state, "prepared");
      assert.equal(outcome.state, "unstarted");
      assert.deepEqual(await write, {id, revision:hash(title)});
      assert.equal(writes, 1);
      assert.equal((await f.status(input.op_id)).state, "verified");
    } else {
      const replay = await write.then(() => "applied", error => error.code);
      assert.deepEqual({status:status.state, outcome:outcome.state, replay, writes, preserved:readFileSync(path).equals(frozen)},
        {status:"unknown", outcome:"pending", replay:"operation_pending", writes:0, preserved:true});
    }
  });
});

test("重试和撤销旧的半途恢复都需要此次恢复自身的写端签名", async t => {
  const f = fixture(t), savedRevision = hash("saved"), partialRevision = hash("partial");
  const backup = {id, title:"原题", markdown:"旧文", raw:"旧文", attrs:{}, revision:hash("before"), signature:"before"};
  const saved = {...backup, title:"新题", markdown:"新文", raw:"新文", revision:savedRevision, signature:"saved"};
  f.record("raw-convert-document", {id, op_id:"original"}, {state:"verified", documentId:id, beforeDocument:backup,
    recoveryRevision:savedRevision, recoverySignature:saved.signature, afterRevision:savedRevision,
    afterSignature:saved.signature, result:{id, revision:savedRevision}});
  const original = {op_id:"partial", backup_op_id:"original", expected_revision:savedRevision};
  const partial = {...saved, markdown:backup.markdown, raw:backup.raw, revision:partialRevision, signature:"edited child"};
  t.mock.method(Documents.prototype, "snapshot", async () => structuredClone(partial));
  let writes = 0;
  f.reader.api = f.reader.setAttrs = async () => { writes++; };
  f.reader.flush = async () => {};
  for (const [index, evidence] of [
    {recoveryRevision:partialRevision},
    {recoveryRevision:partialRevision, afterRevision:partialRevision, afterSignature:partial.signature},
    {afterRevision:partialRevision, afterSignature:partial.signature}
  ].entries()) {
    const path = f.record("recover-document", {...original, expected_hash:savedRevision}, {documentId:id, beforeDocument:saved,
      restoreDocument:backup, intendedTitle:backup.title, intendedMarkdown:backup.markdown, writeStarted:true, ...evidence});
    const frozen = readFileSync(path);
    await assert.rejects(rawWrite(f.reader,"raw-recover",{identity,...original}),
      error => ["invalid_backup","content_conflict","operation_pending"].includes(error.code));
    assert.equal(writes, 0);
    await assert.rejects(rawWrite(f.reader,"raw-recover",{identity,op_id:"undo-partial-"+index,backup_op_id:"partial",
      expected_revision:partialRevision}), error => ["invalid_backup","content_conflict"].includes(error.code));
    assert.equal(writes, 0);
    assert.deepEqual(readFileSync(path), frozen);
  }
});

test("恢复的写前检查点只能用来重试同一次操作", async t => {
  for (const laterAttempt of [false, true]) await t.test(laterAttempt ? "部分恢复后的下一次尝试" : "旧版已冻结但未开写", async t => {
    const f = fixture(t);
    const snapshot = title => ({id, title, raw:title, markdown:title, attrs:{}, revision:hash(title), signature:hash("native:"+title)});
    const original = snapshot("原稿"), saved = snapshot("已保存"), start = laterAttempt ? snapshot("部分恢复") : saved;
    const backup = {op_id:"save", id, title:saved.title, markdown:saved.raw, expected_revision:original.revision};
    f.record("save-document", backup, {state:"verified", documentId:id, beforeDocument:original,
      recoveryRevision:saved.revision, recoverySignature:saved.signature, afterRevision:saved.revision,
      afterSignature:saved.signature, result:{id,revision:saved.revision}});
    const input = {op_id:"restore", backup_op_id:"save", expected_revision:saved.revision, expected_hash:saved.revision};
    const path = f.record("recover-document", input, {state:"prepared", documentId:id, restoreDocument:original,
      beforeDocument:saved, writeStarted:laterAttempt, ...(laterAttempt && {restoreStart:{revision:start.revision,signature:start.signature}})});
    let current = {...start, signature:"独立子块修改"}, writes = 0;
    t.mock.method(Documents.prototype,"snapshot",async () => structuredClone(current));
    f.reader.api = async (route) => {
      writes++;
      if (route === "/api/block/updateBlock") current = original;
    };
    f.reader.setAttrs = f.reader.flush = async () => {};
    const resume = () => rawWrite(f.reader,"raw-recover",{identity,...input});
    const frozen = readFileSync(path);
    assert.equal((await f.status("restore")).recovery_revision, undefined);
    await assert.rejects(resume(), {code:"operation_pending"});
    assert.equal(writes, 0);
    assert.deepEqual(readFileSync(path), frozen);
    current = start;
    assert.equal((await resume()).revision, original.revision);
    assert.equal((await resume()).revision, original.revision);
    assert.equal(writes, 2);
  });
});

test("写后证据落盘后进程中断，prepared 的部分保存仍可按原证据恢复", async t => {
  const f = fixture(t), op = {id, title:"新题", markdown:"新文", op_id:"save", expected_revision:hash("before")};
  const before = {id,title:"原标题",raw:"旧文",markdown:"旧文",attrs:{},revision:op.expected_revision,signature:"before"};
  const partial = {...before, raw:"新文", markdown:"新文", revision:hash("partial"), signature:"written native blocks"};
  f.record("save-document", op, {state:"prepared", documentId:id, beforeDocument:before,
    intendedTitle:op.title,intendedMarkdown:op.markdown,writeStarted:true,
    recoveryRevision:partial.revision,recoverySignature:partial.signature});
  let current = {...partial, signature:"later child edit"}, writes = 0;
  t.mock.method(Documents.prototype,"snapshot",async () => structuredClone(current));
  f.reader.api = async () => { writes++; current = before; };
  f.reader.setAttrs = f.reader.flush = async () => {};
  const status = await f.status("save");
  assert.equal(status.state, "prepared");
  assert.equal(status.recovery_revision, partial.revision);
  const restore = op_id => rawWrite(f.reader,"raw-recover",{identity,op_id,backup_op_id:"save",
    expected_revision:status.recovery_revision});
  await assert.rejects(restore("refuse-later"), {code:"content_conflict"});
  assert.equal(writes,0);
  current = partial;
  assert.equal((await restore("restore-partial")).revision,before.revision);
  assert.equal(writes,2);
});

test("批次恢复取得锁前原写入已核实，保留已完成的文档", async t => {
  const f = fixture(t), revision = hash("current");
  const backup = {id, op_id: "pending-backup", title: "已完成的保存", markdown: "新正文", expected_revision: "before"};
  f.record("save-document", backup, {documentId: id, intendedTitle: backup.title, intendedMarkdown: backup.markdown,
    recoveryRevision: revision, recoverySignature: "current", beforeDocument: {id, title: "原始", markdown: "旧正文", raw: "旧正文", attrs: {}}});
  t.mock.method(Documents.prototype, "snapshot", async () => ({id, title: backup.title, markdown: backup.markdown,
    raw: backup.markdown, revision, signature: "current", attrs: {}}));
  const operate = f.reader.operate.bind(f.reader);
  f.reader.operate = async (...args) => {
    assert.equal((await execute(f.writer, "operation-status", {op_id: backup.op_id})).state, "verified");
    return operate(...args);
  };
  let writes = 0;
  f.reader.api = async () => { writes++; throw Object.assign(new Error("unexpected restore"), {code: "transport_unknown"}); };
  await assert.rejects(rawWrite(f.reader, "raw-recover", {identity, op_id: "undo", backup_op_id: backup.op_id,
    expected_revision: revision, pendingOps: [backup.op_id]}), {code: "operation_pending"});
  assert.equal(writes, 0);
  assert.equal((await f.reader.receipt("undo")).value, null);
});

test("重跑恢复遇到另一请求的操作 ID 时，保留两份原回执", async t => {
  const f = fixture(t), revision = hash("current");
  const backup = f.record("save-document", {op_id: "backup"}, {state: "verified", afterRevision: revision,
    documentId: id, beforeDocument: {id, raw: "旧正文"}});
  const other = f.record("update-block", {op_id: "undo"}, {blockId: id, intended: "现有正文"});
  const original = readFileSync(other), originalBackup = readFileSync(backup);
  let reads = 0;
  f.reader.markdown = async () => { reads++; return "现有正文"; };
  await assert.rejects(rawWrite(f.reader, "raw-recover", {identity, op_id: "undo", backup_op_id: "backup",
    expected_revision: revision}), {code: "operation_conflict"});
  assert.deepEqual(readFileSync(other), original);
  assert.deepEqual(readFileSync(backup), originalBackup);
  assert.equal(reads, 0);
});

test("首次写前探测和同 ID 重放由同一写锁决定", async t => {
  const f = fixture(t);
  const input = {id, op_id:"same-save", title:"标题", markdown:"正文", expected_revision:"before"};
  const frozen = {...input, identity, kind:"card"};
  const started = Promise.withResolvers(), release = Promise.withResolvers();
  f.reader.sql = async () => { started.resolve(); await release.promise; return []; };
  const first = rawWrite(f.reader, "raw-document", frozen);
  await started.promise;
  const result = {id, revision:"after"};
  const other = () => f.writer.operate("save-document", input, rec => {
    Object.assign(rec, {documentId:id, recoveryRevision:result.revision, recoverySignature:"native",
      afterRevision:result.revision, afterSignature:"native"});
    return result;
  });
  try { await assert.rejects(other(), {code:"write_locked"}); }
  finally { release.resolve(); await assert.rejects(first, {code:"content_conflict"}); }
  assert.deepEqual(await other(), result);
  f.reader.sql = () => assert.fail("verified replay must not probe the old revision");
  assert.deepEqual(await rawWrite(f.reader, "raw-document", frozen), result);
});
