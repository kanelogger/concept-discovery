import { documentReceiptView, isUnprovenDocumentReceipt } from "./document-receipt.mjs";
import { markdownStart } from "./markdown.mjs";
import { fromMarkdown } from "mdast-util-from-markdown";
import { createHash, randomBytes } from "node:crypto";
import {
  readFileSync,
  mkdirSync,
  writeFileSync,
  renameSync,
  existsSync,
  openSync,
  closeSync,
  unlinkSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
export const hash = (value) =>
  createHash("sha256")
    .update(
      typeof value === "string" || ArrayBuffer.isView(value)
        ? value
        : JSON.stringify(value),
    )
    .digest("hex");
export const id = () =>
  new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  })
    .format(new Date())
    .replace(/\D/g, "") +
  "-" +
  randomBytes(5).toString("hex").slice(0, 7);
export function canonical(value) {
  return Array.isArray(value)
    ? value.map(canonical)
    : value && typeof value === "object"
      ? Object.fromEntries(
          Object.keys(value)
            .sort()
            .map((k) => [k, canonical(value[k])]),
        )
      : value;
}
export const quote = (v) => "'" + String(v).replaceAll("'", "''") + "'";
export const deletedAttr = "custom-cd-deleted";

export function activePath(path, box, exceptId) {
  return `NOT EXISTS (
    SELECT 1 FROM attributes tombstone JOIN blocks removed ON removed.id=tombstone.block_id
    WHERE tombstone.name='${deletedAttr}' AND tombstone.value<>''
      AND removed.box=${box} AND removed.type='d'
      ${exceptId ? "AND removed.id<>" + exceptId : ""}
      AND (${path}=removed.path OR instr(${path},substr(removed.path,1,length(removed.path)-3)||'/')=1)
  )`;
}

export function fail(code, message) {
  throw Object.assign(new Error(message), { code });
}
export function save(path, value) {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const tmp = path + ".tmp";
  writeFileSync(tmp, JSON.stringify(value, null, 2) + "\n", { mode: 0o600 });
  renameSync(tmp, path);
}
export function config(path = process.env.CONCEPT_DISCOVERY_CONFIG) {
  if (!path) fail("configuration", "Set CONCEPT_DISCOVERY_CONFIG");
  const c = JSON.parse(readFileSync(resolve(path), "utf8"));
  c.dataDir = resolve(dirname(resolve(path)), c.dataDir ?? "operations");
  c.token = c.tokenFile
    ? readFileSync(resolve(dirname(resolve(path)), c.tokenFile), "utf8").trim()
    : process.env[c.tokenEnv ?? "SIYUAN_API_TOKEN"];
  return c;
}
export async function initializeLibrary(api, configPath, name) {
  const identity = await api.initialize(name);
  const { token, ...settings } = api.c;
  save(configPath, {...settings, ...identity});
  return identity;
}

export class Siyuan {
  #receiptLease;
  #receiptBusy = false;
  constructor(c, {receiptLease} = {}) {
    this.c = c;
    this.#receiptLease = receiptLease;
    const u = new URL(c.url);
    if (u.username || u.password || u.search || u.hash || u.pathname !== "/")
      fail("configuration", "URL must be an origin without credentials");
    if (
      u.protocol !== "https:" &&
      !(
        u.protocol === "http:" &&
        (c.internal === true || ["127.0.0.1", "localhost", "[::1]"].includes(u.hostname))
      )
    )
      fail("configuration", "Remote service requires HTTPS");
    if (!c.token) fail("configuration", "API token missing");
    this.origin = u.origin;
  }
  async api(path, body = {}, { signal } = {}) {
    let r;
    const timeout = AbortSignal.timeout(30000);
    try {
      r = await fetch(this.origin + path, {
        method: "POST",
        redirect: "error",
        signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
        headers: {
          Authorization: "Token " + this.c.token,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });
    } catch {
      signal?.throwIfAborted();
      fail(
        "transport_unknown",
        "Request outcome unknown; inspect operation-status before retrying",
      );
    }
    if (!r.ok) fail("http_" + r.status, "SiYuan HTTP " + r.status);
    let p;
    try {
      const text = await r.text();
      p = JSON.parse(text);
    } catch {
      signal?.throwIfAborted();
      fail(
        "transport_unknown",
        "Invalid JSON from " + path + " (status " + r.status + ")",
      );
    }
    if (p.code !== 0)
      fail(
        "siyuan_error",
        String(p.msg).replaceAll(this.c.token, "[redacted]"),
      );
    return p.data;
  }
  async sql(stmt, options) {
    return await this.api("/api/query/sql", { stmt, mode: "readonly" }, options);
  }
  async flush() {
    await this.api("/api/sqlite/flushTransaction");
  }
  async attrs(block, options) {
    return await this.api("/api/attr/getBlockAttrs", { id: block }, options);
  }
  async setAttrs(block, attrs) {
    await this.api("/api/attr/setBlockAttrs", { id: block, attrs });
  }
  async markdown(block, options) {
    return (await this.api("/api/block/getBlockKramdown", { id: block }, options))
      .kramdown;
  }
  async markdowns(ids, options) {
    return this.api("/api/block/getBlockKramdowns", { ids }, options);
  }
  async inScope(block, options) {
    if (!/^\d{14}-[a-z0-9]{7}$/.test(block))
      fail("invalid_id", "Invalid SiYuan block ID");
    const rows = await this.sql(
      `SELECT id,root_id,path,type FROM blocks WHERE id=${quote(block)} AND box=${quote(this.c.notebookId)}`,
      options,
    );
    if (rows.length !== 1)
      fail("outside_scope", "Block is not in configured notebook");
    return rows[0];
  }
  async identity(options) {
    if (!this.c.notebookId || !this.c.libraryRootId)
      fail("configuration", "Initialize a library first");
    await this.inScope(this.c.libraryRootId, options);
    const a = await this.attrs(this.c.libraryRootId, options);
    if (!a["custom-cd-library"])
      fail("configuration", "Library marker missing");
    return this.origin + "|" + this.c.notebookId + "|" + a["custom-cd-library"];
  }
  async newDoc(docId, title, markdown, parentID = null) {
    await this.api("/api/filetree/createDocByParent", {
      notebook: this.c.notebookId,
      parentID,
      id: docId,
      title: { format: "plain", text: title },
      markdown,
    });
    await this.flush();
    return docId;
  }
  async ready(notebook) {
    for (let n = 0; n < 100; n++) {
      try {
        await this.api("/api/filetree/getDocPaths", {
          notebook,
          ids: [notebook],
        });
        return;
      } catch (e) {
        if (!/metadata|index|索引/.test(e.message)) throw e;
        await new Promise((r) => setTimeout(r, 100));
      }
    }
    fail("not_ready", "Notebook index not ready");
  }
  async initialize(name = "Concept Discovery") {
    const list = (await this.api("/api/notebook/lsNotebooks")).notebooks;
    if (list.some((n) => n.name === name))
      fail(
        "already_exists",
        "Choose a unique notebook name; do not adopt by name",
      );
    const n = (await this.api("/api/notebook/createNotebook", { name }))
      .notebook.id;
    this.c.notebookId = n;
    await this.ready(n);
    const root = id();
    await this.newDoc(
      root,
      "知识卡",
      "从一条自己的理解开始，不必填写完整模板。\n\n## 记下一张卡\n\n在本地 raw/ 学科目录中维护 article.md，标题写概念或方法，正文写自己的理解，按需补上出处、用法、边界、自测问题和相关链接。运行 npm run raw -- check 校验原稿，用 npm run raw -- sync --dry-run 预览，再用 npm run raw -- sync 同步。\n\n## 按当前任务找知识\n\n用搜索框输入概念、原文词语或任务线索。打开卡片时同时看出处与何时不适用；没有命中时换一个线索。\n\n## 请 Agent 帮忙\n\n在当前任务对话中明确要求查询、运用或维护知识卡。Agent 通过只读接口查询。需要维护时，在本地修改相应原稿，同步后核对结果。",
    );
    await this.setAttrs(root, { "custom-cd-library": id() });
    const relations = id();
    await this.newDoc(
      relations,
      "关系归档",
      "# 关系归档\n\n旧关系信息由迁移工具保留。日常直接在卡片正文链接相关知识，无需填写关系表。",
    );
    this.c.libraryRootId = root;
    this.c.relationsRootId = relations;
    return { notebookId: n, libraryRootId: root, relationsRootId: relations };
  }
  async requireActivePath(path, exceptId) {
    const visible = activePath(quote(path), quote(this.c.notebookId), exceptId && quote(exceptId));
    if (!(await this.sql(`SELECT 1 WHERE ${visible}`)).length)
      fail("outside_scope", "This card or its parent has been deleted");
  }
  async target(block) {
    const info = await this.inScope(block);
    if (!info.path.startsWith("/" + this.c.libraryRootId + "/"))
      fail("outside_scope", "Block is outside the managed concept tree");
    await this.requireActivePath(info.path);
    const a = await this.attrs(info.root_id);
    if (
      info.type === "d" ||
      (info.type === "h" &&
        !(
          a["custom-cd-schema"] === "2" &&
          (await this.attrs(block))["custom-cd-role"] === "question"
        ))
    )
      fail(
        "outside_scope",
        "Document roots and structure headings are not editable through this command",
      );
    if (
      a["custom-cd-kind"] &&
      a["custom-cd-kind"] !== "concept" &&
      a["custom-cd-kind"] !== "article"
    )
      fail(
        "outside_scope",
        "Only managed concept and article content can be modified",
      );
    return info;
  }
  async receipt(opId) {
    if (typeof opId !== "string" || !/^[a-zA-Z0-9_-]{1,100}$/.test(opId))
      fail("invalid_input", "op_id required (letters, digits, _ or -)");
    const p = resolve(this.c.dataDir, opId + ".json");
    const value = existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : null;
    return {p, value:documentReceiptView(value)};
  }
  // A busy reader may inspect the atomically published receipt, but never
  // confirm it. Only the owner receives a function that can publish a change.
  async withReceipt(opId, visit, { readWhenBusy = false } = {}) {
    mkdirSync(this.c.dataDir, { recursive: true, mode: 0o700 });
    const lock = resolve(this.c.dataDir, "write.lock");
    if (this.#receiptLease) {
      this.#receiptLease();
      if (existsSync(lock) || this.#receiptBusy) {
        if (!readWhenBusy) fail("write_locked","已有原稿写入，须先核对写入状态。");
        return visit((await this.receipt(opId)).value,null);
      }
      this.#receiptBusy = true;
      try {
        const {p,value} = await this.receipt(opId);
        return await visit(value,rec=>save(p,rec));
      } finally {
        this.#receiptBusy = false;
      }
    }
    let fd;
    try {
      fd = openSync(lock, "wx", 0o600);
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      if (!readWhenBusy) fail("write_locked", "Another write is active; inspect abandoned lock manually");
      return visit((await this.receipt(opId)).value, null);
    }
    try {
      const {p, value} = await this.receipt(opId);
      return await visit(value, rec => save(p, rec));
    } finally {
      try { closeSync(fd); } finally { unlinkSync(lock); }
    }
  }
  async operate(command, input, perform, { retryDocument, retryRecovery = false, confirm, guard } = {}) {
    const guardedRecovery = retryRecovery && ["recover-deleted-document", "recover-append", "update-block"].includes(command);
    const target = await this.identity();
    const requestHash = hash(canonical({ command, input, target }));
    return this.withReceipt(input.op_id, async (rec, publish) => {
      const persist = () => publish(rec);
      if (rec && (rec.requestHash !== requestHash || rec.command !== command || rec.target !== target))
        fail("operation_conflict", "op_id already belongs to another request or target");
      if (isUnprovenDocumentReceipt(rec)) fail("operation_pending", rec.error.message);
      if (guard) await guard(rec);
      if (rec) {
        if (confirm && rec.state !== "verified") await confirm(rec, persist);
        if (rec.state === "verified") return rec.result;
        if (!["delete-document", "raw-create-document", "raw-create-relation", "raw-order-readings"].includes(command)) {
          // Raw document retries verify the snapshot here. Single-write
          // recoveries recheck the deletion marker or hash in perform, under the same lock.
          const mayRetry = guardedRecovery || (["save-document","raw-convert-document","recover-document"].includes(command) &&
            retryDocument && await retryDocument(rec));
          if (!mayRetry)
            fail("operation_pending", "Use operation-status before retrying");
          (rec.retryHistory ??= []).push({at:new Date().toISOString(),state:rec.state,
            error:rec.error ?? null,writeStarted:Boolean(rec.writeStarted),completed:rec.completed ?? 0});
          rec.state="prepared";
          delete rec.error;
        }
      } else
        rec = {
          command,
          input,
          target,
          requestHash,
          state: "prepared",
          createdAt: new Date().toISOString(),
        };
      persist();
      try {
        const result = await perform(rec, persist);
        rec.result = result;
        rec.state = "verified";
        persist();
        return result;
      } catch (e) {
        rec.state = (guardedRecovery && rec.writeStarted) || [
          "transport_unknown",
          "readback_conflict",
          "operation_pending",
        ].includes(e.code)
          ? "unknown"
          : "failed";
        rec.error = { code: e.code ?? "error", message: e.message };
        persist();
        throw e;
      }
    });
  }
  async update(input, retryOptions) {
    return this.operate("update-block", input, async (rec, persist) => {
      const scope = await this.target(input.id);
      const before = await this.markdown(input.id);
      if (hash(before) !== input.expected_hash)
        fail("content_conflict", "Content changed; read it again");
      if (typeof input.markdown !== "string")
        fail("invalid_input", "markdown required");
      const shape = fromMarkdown(normalize(input.markdown)).children;
      if (scope.type !== "s" && shape.length !== 1)
        fail(
          "invalid_input",
          "update-block needs one Markdown block",
        );
      if (scope.type === "s") {
        const lines = normalize(input.markdown).split("\n");
        if (
          lines.filter((l) => /^\{\{\{(?:row|col)?$/.test(l.trim())).length !==
            1 ||
          lines.filter((l) => l.trim() === "}}}").length !== 1
        )
          fail("invalid_input", "Keep one superblock container");
      }
      rec.before = before;
      rec.blockId = input.id;
      rec.intended = input.markdown;
      if (retryOptions?.retryRecovery) rec.writeStarted = true;
      persist();
      await this.api("/api/block/updateBlock", {
        id: input.id,
        dataType: "markdown",
        data: input.markdown,
        lockType: true,
      });
      await this.flush();
      const after = await this.markdown(input.id);
      rec.after = after;
      rec.afterHash = hash(after);
      persist();
      if (normalize(after) !== normalize(input.markdown))
        fail(
          "readback_conflict",
          "Written content differs; inspect backup and current content",
        );
      return {
        id: input.id,
        markdown: after,
        hash: hash(after),
        op_id: input.op_id,
      };
    }, retryOptions);
  }
  async recover(input, retryOptions) {
    const original = (await this.receipt(input.backup_op_id)).value;
    if (
      !original ||
      original.state !== "verified" ||
      !original.before ||
      original.target !== (await this.identity())
    )
      fail("invalid_backup", "Verified backup for this target required");
    if (input.expected_hash !== original.afterHash)
      fail(
        "content_conflict",
        "Recovery requires the saved post-write fingerprint",
      );
    return this.update({
      op_id: input.op_id,
      id: original.blockId,
      expected_hash: input.expected_hash,
      markdown: original.before,
    }, retryOptions);
  }

}
// Native attributes may contain quoted braces. Literal Markdown spans keep the
// original bytes, including line endings, trailing spaces and dollar signs.
function attributeEnd(source, start, literals, nextLiteral) {
  // A native attribute list ends on its opening line, even inside a quoted
  // value, an escape, or a Markdown literal spanning several lines.
  const lineBreak = /[\r\n]/;
  let quoteChar = null;
  for (let i = start; i < source.length; i++) {
    const literal = literals[nextLiteral];
    if (literal && i === literal.start) {
      if (lineBreak.test(source.slice(i, literal.end))) return -1;
      i = literal.end - 1;
      nextLiteral++;
      continue;
    }
    const ch = source[i];
    if (lineBreak.test(ch)) return -1;
    if (ch === "\\") {
      i++;
      if (lineBreak.test(source[i])) return -1;
    } else if (quoteChar) {
      if (ch === quoteChar) quoteChar = null;
    } else if (ch === '"' || ch === "'") quoteChar = ch;
    else if (ch === "}") return i + 1;
  }
  return -1;
}

export function normalize(source) {
  source = source.replace(/^\uFEFF/, "");
  const literals = [];
  function visit(node) {
    if (["code", "inlineCode", "html"].includes(node.type)) {
      literals.push({ start: markdownStart(source, node), end: node.position.end.offset });
    } else {
      for (const child of node.children ?? []) visit(child);
    }
  }
  visit(fromMarkdown(source));

  const prefix = /(?<!\\)\{: id="\d{14}-[a-z0-9]{7}"/g;
  const pieces = [];
  let prose = "", cursor = 0, nextLiteral = 0, attribute = prefix.exec(source);
  while (attribute || nextLiteral < literals.length) {
    const literal = literals[nextLiteral];
    if (literal && (!attribute || literal.start <= attribute.index)) {
      prose += source.slice(cursor, literal.start);
      pieces.push(prose.replace(/\r\n?/g, "\n"), source.slice(literal.start, literal.end));
      prose = "";
      cursor = literal.end;
      nextLiteral++;
    } else {
      const end = attributeEnd(source, prefix.lastIndex, literals, nextLiteral);
      if (end !== -1) {
        prose += source.slice(cursor, attribute.index);
        cursor = end;
        while (literals[nextLiteral]?.start < end) nextLiteral++;
      }
      prefix.lastIndex = Math.max(prefix.lastIndex, cursor);
      attribute = prefix.exec(source);
      continue;
    }
    if (attribute && attribute.index < cursor) {
      prefix.lastIndex = cursor;
      attribute = prefix.exec(source);
    }
  }
  pieces.push((prose + source.slice(cursor)).replace(/\r\n?/g, "\n"));
  pieces[0] = pieces[0].trimStart();
  pieces[pieces.length - 1] = pieces.at(-1).trimEnd();
  return pieces.join("");
}
