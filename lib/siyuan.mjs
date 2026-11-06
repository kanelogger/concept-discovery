import { fromMarkdown } from "mdast-util-from-markdown";
import { createHash, randomBytes } from "node:crypto";
import {
  readFileSync,
  mkdirSync,
  writeFileSync,
  renameSync,
  existsSync,
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
  new Intl.DateTimeFormat("sv-SE", {
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
export class Siyuan {
  constructor(c) {
    this.c = c;
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
  async markdown(block) {
    return (await this.api("/api/block/getBlockKramdown", { id: block }))
      .kramdown;
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
      "从一条自己的理解开始，不必填写完整模板。\n\n## 记下一张卡\n\n点击新建，标题写概念或方法，正文写自己的理解；按需补上出处、用法、边界、自测问题和相关链接。编辑后保存，并留意保存结果。\n\n## 按当前任务找知识\n\n用搜索框输入概念、原文词语或任务线索。打开卡片时同时看出处与何时不适用；没有命中时换一个线索。\n\n## 请 Agent 帮忙\n\n在当前任务对话中明确要求查询、运用或维护知识卡。Agent 写入前读取当前内容，写后核对；遇到冲突先重新读取。网络结果不明时，先核对操作状态再继续。",
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
    return {
      p,
      value: existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : null,
    };
  }
  async operate(command, input, perform) {
    const target = await this.identity();
    const { p } = await this.receipt(input.op_id);
    const requestHash = hash(canonical({ command, input, target }));
    mkdirSync(this.c.dataDir, { recursive: true, mode: 0o700 });
    const fs = await import("node:fs");
    const lock = resolve(this.c.dataDir, "write.lock");
    let fd;
    try {
      fd = fs.openSync(lock, "wx", 0o600);
    } catch {
      fail(
        "write_locked",
        "Another write is active; inspect abandoned lock manually",
      );
    }
    let rec;
    try {
      rec = existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : null;
      if (rec) {
        if (rec.requestHash !== requestHash)
          fail(
            "operation_conflict",
            "op_id already belongs to another request or target",
          );
        if (rec.state === "verified") return rec.result;
        if (!["create", "create-document", "delete-document"].includes(command))
          fail("operation_pending", "Use operation-status before retrying");
      } else
        rec = {
          command,
          input,
          target,
          requestHash,
          state: "prepared",
          createdAt: new Date().toISOString(),
        };
      save(p, rec);
      try {
        const result = await perform(rec, () => save(p, rec));
        rec.result = result;
        rec.state = "verified";
        save(p, rec);
        return result;
      } catch (e) {
        rec.state = [
          "transport_unknown",
          "readback_conflict",
          "operation_pending",
        ].includes(e.code)
          ? "unknown"
          : "failed";
        rec.error = { code: e.code ?? "error", message: e.message };
        save(p, rec);
        throw e;
      }
    } finally {
      fs.closeSync(fd);
      fs.rmSync(lock, { force: true });
    }
  }
  async update(input) {
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
          "update-block needs one Markdown block; use append for new sections",
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
    });
  }
  async recover(input) {
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
    });
  }
  async operationStatus(input) {
    const { p, value: r } = await this.receipt(input.op_id);
    if (!r || r.target !== (await this.identity()))
      fail("operation_conflict", "Operation does not belong to this library");
    if (r.state === "unknown" || r.state === "prepared") {
      if (r.command === "create" && r.documentId) {
        try {
          const a = await this.attrs(r.documentId);
          if (
            a["custom-cd-request"] === r.requestHash &&
            a["custom-cd-complete"] === "1"
          ) {
            r.state = "verified";
            r.result = { id: r.documentId, op_id: input.op_id };
            save(p, r);
          }
        } catch {}
      } else if (r.blockId) {
        const md = await this.markdown(r.blockId);
        if (normalize(md) === normalize(r.intended)) {
          r.state = "verified";
          r.after = md;
          r.afterHash = hash(md);
          r.result = {
            id: r.blockId,
            hash: hash(md),
            markdown: md,
            op_id: input.op_id,
          };
          save(p, r);
        }
      }
    }
    return {
      op_id: input.op_id,
      state: r.state,
      result: r.result,
      error: r.error,
    };
  }
}
export function normalize(source) {
  const protectedSpans = [];
  function visit(node) {
    if (["code", "inlineCode", "html"].includes(node.type) && node.position) {
      protectedSpans.push([
        node.position.start.offset,
        node.position.end.offset,
      ]);
      return;
    }
    for (const child of node.children ?? []) visit(child);
  }
  visit(fromMarkdown(source));
  const replacements = [];
  let text = source;
  const nonce = randomBytes(8).toString("hex");
  for (const [start, end] of protectedSpans.sort((a, b) => b[0] - a[0])) {
    const token = `CD_PROTECTED_${nonce}_${replacements.length}`;
    replacements.push([token, source.slice(start, end)]);
    text = text.slice(0, start) + token + text.slice(end);
  }
  const expression = /(?<!\\)\{: id="[0-9]{14}-[a-z0-9]{7}"/g;
  let clean = "",
    cursor = 0,
    match;
  while ((match = expression.exec(text))) {
    let quoteChar = null,
      escaped = false,
      end = -1;
    for (let n = match.index + 2; n < text.length; n++) {
      const ch = text[n];
      if (escaped) {
        escaped = false;
        continue;
      }
      if (ch === "\\") {
        escaped = true;
        continue;
      }
      if (quoteChar) {
        if (ch === quoteChar) quoteChar = null;
      } else if (ch === '"' || ch === "'") {
        quoteChar = ch;
      } else if (ch === "}") {
        end = n;
        break;
      } else if (ch === "\n") break;
    }
    if (end < 0) continue;
    clean += text.slice(cursor, match.index);
    cursor = end + 1;
    expression.lastIndex = cursor;
  }
  text = (clean + text.slice(cursor)).replace(/\r/g, "").trim();
  for (const [token, value] of replacements) text = text.replace(token, value);
  return text;
}
