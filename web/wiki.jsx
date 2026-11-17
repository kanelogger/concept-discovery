import React, { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Alert, Button, Checkbox, Empty, Flex, Form, Input, Radio, Select, Spin, Tag, Typography } from "antd";
import { FileTextOutlined, ReloadOutlined, UploadOutlined } from "@ant-design/icons";
import { clearSavedUnderstandingDraft, createWikiOperations, decodeWikiSource, latestWikiSources, reviewedWikiChoice } from "./wiki-async.mjs";
import "./wiki.css";

const { Title, Text, Paragraph } = Typography;
const SOURCE_LIMIT = 200000;
const SOURCE_BYTES = 1024 * 1024;
const emptySource = () => ({ title: "", markdown: "", url: "", author: "", sourceId: "" });
const operationId = prefix => `${prefix}_${globalThis.crypto.randomUUID().replaceAll("-", "")}`;
const note = (error, fallback) => error?.status === 401
  ? "访问已过期。重新登录后，你的输入仍会保留。"
  : error?.message || fallback;
const uncertain = error => error?.status === 401 || error?.status >= 500 || ["transport_unknown", "operation_pending", "readback_conflict"].includes(error?.code);
const statusNames = {
  draft: "待审阅", pending: "待采用", applying: "正在核对", partial: "部分完成", applied: "已采用", conflict: "存在冲突", unknown: "结果待核对", skipped: "未采用", recovered: "已恢复",
};
const statusText = state => statusNames[state] || state || "待审阅";
const timeText = date => {
  const value = new Date(date);
  return Number.isNaN(value.valueOf()) ? "" : new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "short" }).format(value);
};
const sourceLabel = source => `${source.title || "未命名资料"}${source.version ? ` · 第 ${source.version} 版` : ""}`;
function safeURL(value) {
  try { const url = new URL(value); return ["http:", "https:"].includes(url.protocol) ? url.href : null; } catch { return null; }
}

function Notice({ value }) {
  return <div className="wiki-notice" role="status" aria-live="polite">
    {value && <Alert type={value.error ? "error" : "info"} title={value.text} />}
  </div>;
}

function SourceText({ source }) {
  return <section className="wiki-source-reading" aria-label="原始资料">
    <Flex wrap align="baseline" gap={12}>
      <Title level={3}>{source.title}</Title>
      <Text type="secondary">{source.version ? `第 ${source.version} 版` : "原文快照"}</Text>
    </Flex>
    {(source.author || source.createdAt) && <Paragraph type="secondary">{[source.author, timeText(source.createdAt)].filter(Boolean).join(" · ")}</Paragraph>}
    {safeURL(source.url) && <Paragraph><a href={safeURL(source.url)} target="_blank" rel="noreferrer noopener">打开出处</a></Paragraph>}
    <pre className="wiki-source-text">{source.markdown}</pre>
  </section>;
}

function proposalDraft(proposal) {
  return Object.fromEntries((proposal?.items || []).map(item => [item.id, {
    selected: item.status === "pending" || !item.status,
    title: item.title || "", question: item.question || "", body: item.body || "",
  }]));
}

export function WikiPage({ command, active, authenticated, askAvailable, onOpenCard, onDirtyChange, initialSourceId, readModelSettings }) {
  const uid = useId().replaceAll(":", "");
  const [tab, setTab] = useState("sources");
  const [sources, setSources] = useState([]);
  const [proposals, setProposals] = useState([]);
  const [source, setSource] = useState(null);
  const [proposal, setProposal] = useState(null);
  const [draft, setDraft] = useState(emptySource);
  const [edits, setEdits] = useState({});
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState(null);
  const [sourceErrors, setSourceErrors] = useState({});
  const [events, setEvents] = useState([]);
  const [modelView, setModelView] = useState(null);
  const [modelViewError, setModelViewError] = useState("");
  const [importPending, setImportPending] = useState(false);
  const [applyPending, setApplyPending] = useState(false);
  const importRequest = useRef(null);
  const applyRequest = useRef(null);
  const operations = useRef(null);
  if (!operations.current) operations.current = createWikiOperations({ active: active && authenticated, key: initialSourceId || "" });
  const dirtyCallback = useRef(onDirtyChange);
  dirtyCallback.current = onDirtyChange;
  const uploadRef = useRef(null);
  const titleRef = useRef(null);
  const bodyRef = useRef(null);
  const urlRef = useRef(null);
  const reviewDrafts = useRef(new Map());
  const length = useMemo(() => Array.from(draft.markdown).length, [draft.markdown]);
  const sourceGroups = useMemo(() => latestWikiSources(sources), [sources]);
  const sourceDirty = Boolean(draft.title || draft.markdown || draft.url || draft.author || draft.sourceId);
  const reviewDirty = useMemo(() => {
    if (!proposal) return false;
    const original = proposalDraft(proposal);
    return Object.entries(edits).some(([id, edit]) => original[id] && ["title", "body", "question", "selected"].some(key => edit[key] !== original[id][key]));
  }, [proposal, edits]);
  const dirty = sourceDirty || reviewDirty || ["import", "generate", "apply", "recover", "file"].includes(busy) || importPending || applyPending;
  useLayoutEffect(() => { operations.current.setView({ active: active && authenticated, key: initialSourceId || "" }); }, [active, authenticated, initialSourceId]);
  useEffect(() => { dirtyCallback.current?.(Boolean(active && dirty)); }, [active, dirty]);
  useEffect(() => () => dirtyCallback.current?.(false), []);

  function beginOperation(kind, viewKey) {
    if (viewKey !== undefined) operations.current.changeView(viewKey);
    const ticket = operations.current.begin(kind);
    setBusy(operations.current.busy());
    return ticket;
  }
  function finishOperation(ticket) { operations.current.finish(ticket); setBusy(operations.current.busy()); }
  const canPresent = ticket => operations.current.isCurrent(ticket);

  async function refreshLists(ticket) {
    const [sourceList, proposalList, eventList] = await Promise.all([
      command("sources-list", {}), command("wiki-proposals", {}), command("wiki-events", {}),
    ]);
    if (!ticket || canPresent(ticket)) { setSources(sourceList.items || []); setProposals(proposalList.items || []); setEvents(eventList.items || []); }
  }
  async function refreshAfterSuccess(ticket) {
    if (!canPresent(ticket)) return;
    try { await refreshLists(ticket); }
    catch (error) { if (canPresent(ticket)) setNotice({ error: true, text: note(error, "操作已完成，但列表暂时无法刷新。重新进入页面后可继续查看。") }); }
  }
  async function refreshVisibleLists() {
    const ticket = beginOperation("lists");
    try { await refreshLists(ticket); }
    catch (error) { if (canPresent(ticket)) setNotice({ error: true, text: note(error, "列表暂时无法更新。") }); }
    finally { finishOperation(ticket); }
  }
  useEffect(() => {
    if (!active || !authenticated) return;
    let current = true;
    Promise.all([command("sources-list", {}), command("wiki-proposals", {}), command("wiki-events", {})])
      .then(([sourceList, proposalList, eventList]) => {
        if (!current) return;
        setSources(sourceList.items || []); setProposals(proposalList.items || []); setEvents(eventList.items || []);
      }).catch(error => { if (current) setNotice({ error: true, text: note(error, "暂时无法读取资料与提案，请重试。") }); });
    return () => { current = false; };
  }, [active, authenticated, command]);
  useEffect(() => {
    if (!active || !authenticated || !readModelSettings) return;
    let valid = true;
    readModelSettings().then(value => {
      if (!valid) return;
      setModelView({ configured: value.configured, baseUrl: value.baseUrl, model: value.model }); setModelViewError("");
    }).catch(error => { if (valid) setModelViewError(note(error, "暂时无法读取模型目的地，生成前会再次核对。")); });
    return () => { valid = false; };
  }, [active, authenticated, readModelSettings]);

  async function openSource(id) {
    const ticket = beginOperation("source", `source:${id}`);
    setNotice(null);
    try {
      const value = await command("source-get", { id });
      if (canPresent(ticket)) { setSource(value); setTab("sources"); }
    } catch (error) { if (canPresent(ticket)) setNotice({ error: true, text: note(error, "原文暂时无法读取。") }); }
    finally { finishOperation(ticket); }
  }
  useEffect(() => {
    if (!active || !authenticated || !initialSourceId) return;
    void openSource(initialSourceId);
  }, [active, authenticated, initialSourceId]);

  function setSourceField(field, value) {
    if (importPending) return;
    importRequest.current = null;
    setDraft(current => ({ ...current, [field]: value }));
    setSourceErrors(current => ({ ...current, [field]: undefined }));
  }
  async function readFile(file) {
    if (!file) return;
    setSourceErrors({});
    if (!/\.(?:md|markdown|txt)$/i.test(file.name)) { setNotice({ error: true, text: "请选择 Markdown 或文本文件（.md、.markdown、.txt）。当前草稿未改动。" }); return; }
    if (file.size > SOURCE_BYTES) { setNotice({ error: true, text: "文件超过 1 MiB，未替换当前草稿。请提供较小的文本文件。" }); return; }
    const ticket = beginOperation("file");
    try {
      const markdown = decodeWikiSource(await file.arrayBuffer());
      if (markdown.includes("\u0000")) throw new Error("文件含有无法作为正文保存的字符，请转换为 UTF-8 文本后重试。");
      if (!canPresent(ticket)) return;
      importRequest.current = null;
      setDraft(current => ({ ...current, markdown, title: current.title || file.name.replace(/\.(?:md|markdown|txt)$/i, "") }));
      setNotice(Array.from(markdown).length > SOURCE_LIMIT
        ? { error: true, text: "文件已完整读入，超过 200,000 字符，尚未保存。请拆分资料后再导入。" }
        : { text: `已读入 ${file.name}。检查正文和出处后，点击保存原始资料。` });
    } catch (error) { if (canPresent(ticket)) setNotice({ error: true, text: note(error, "文件读取失败，当前草稿仍保留。") }); }
    finally { finishOperation(ticket); }
  }
  function validateSource() {
    const errors = {};
    if (!draft.title.trim()) errors.title = "请给这份资料填写标题。";
    if (!draft.markdown.trim()) errors.markdown = "请粘贴正文或选择文本文件。";
    else if (length > SOURCE_LIMIT || new TextEncoder().encode(draft.markdown).byteLength > SOURCE_BYTES) errors.markdown = "正文超过 200,000 字符或 1 MiB；完整输入仍保留，请拆分后保存。";
    if (draft.url && !safeURL(draft.url)) errors.url = "出处需为 http 或 https 地址；也可以留空。";
    setSourceErrors(errors);
    if (errors.title) titleRef.current?.focus();
    else if (errors.markdown) bodyRef.current?.focus();
    else if (errors.url) urlRef.current?.focus();
    return !Object.keys(errors).length;
  }
  async function importSource(event) {
    event?.preventDefault();
    if (busy || !authenticated || (!importPending && !validateSource())) return;
    const input = importRequest.current || {
      op_id: operationId("source"), title: draft.title.trim(), markdown: draft.markdown,
      ...(draft.url.trim() ? { url: draft.url.trim() } : {}), ...(draft.author.trim() ? { author: draft.author.trim() } : {}),
      ...(draft.sourceId ? { sourceId: draft.sourceId } : {}),
    };
    importRequest.current = input;
    const ticket = beginOperation("import"); setNotice(null);
    try {
      const saved = await command("source-import", input);
      if (!canPresent(ticket)) return;
      setSource(saved); setDraft(emptySource()); setImportPending(false); importRequest.current = null;
      setNotice({ text: "原始资料已保存。接下来可生成整理提案；卡片尚未改变。" });
      await refreshAfterSuccess(ticket);
    } catch (error) {
      setImportPending(uncertain(error));
      if (canPresent(ticket)) setNotice({ error: true, text: uncertain(error) ? `${note(error, "暂时无法确认导入结果。")} 请保持当前输入，使用“核对导入结果”继续同一次保存。` : note(error, "原始资料尚未保存，输入仍保留。") });
    } finally { finishOperation(ticket); }
  }
  async function generateProposal() {
    if (!source || busy || !authenticated || !askAvailable) return;
    if (Array.from(source.markdown || "").length > 20000) {
      setNotice({ error: true, text: "原始全文已经保存。首版单次整理最多 20,000 字符，请另存需要整理的选段；不会截断原文或将全文标为已整理。" });
      return;
    }
    const ticket = beginOperation("generate"); setNotice(null);
    try {
      if (readModelSettings) {
        const view = await readModelSettings();
        if (!canPresent(ticket)) return;
        setModelView({ configured: view.configured, baseUrl: view.baseUrl, model: view.model }); setModelViewError("");
        if (!view.configured) { setNotice({ error: true, text: "模型服务当前尚未配置。请在页头模型设置保存可用接口后再生成提案。" }); return; }
      }
      const value = await command("wiki-propose", { sourceId: source.id });
      if (!canPresent(ticket)) return;
      setProposal(value); setEdits(proposalDraft(value)); applyRequest.current = value.pendingApproval || null;
      setApplyPending(Boolean(value.pendingApproval)); setTab("proposals");
      setNotice({ text: "整理提案已生成，尚未修改知识卡。请检查解释、引用与适用边界后采用。" });
      await refreshAfterSuccess(ticket);
    } catch (error) { if (canPresent(ticket)) setNotice({ error: true, text: note(error, "整理未完成，原始资料仍保留。") }); }
    finally { finishOperation(ticket); }
  }
  async function openProposal(id) {
    const ticket = beginOperation("proposal", `proposal:${id}`); setNotice(null);
    try {
      const value = await command("wiki-proposal", { id });
      if (!canPresent(ticket)) return;
      setProposal(value); setEdits(reviewDrafts.current.get(value.id)?.revision === value.revision ? reviewDrafts.current.get(value.id).edits : proposalDraft(value)); setTab("proposals");
      applyRequest.current = value.pendingApproval || null;
      setApplyPending(Boolean(value.pendingApproval) || ["unknown", "applying"].includes(value.state));
    } catch (error) { if (canPresent(ticket)) setNotice({ error: true, text: note(error, "提案暂时无法读取。") }); }
    finally { finishOperation(ticket); }
  }
  function setItem(id, patch) {
    if (applyPending) return;
    setEdits(current => {
      const next = { ...current, [id]: { ...current[id], ...patch } };
      if (proposal) reviewDrafts.current.set(proposal.id, { revision: proposal.revision, edits: next });
      return next;
    });
  }
  async function adoptProposal(event) {
    event?.preventDefault();
    if (!proposal || busy || !authenticated) return;
    const input = applyRequest.current?.id === proposal.id ? applyRequest.current : {
      id: proposal.id, expected_revision: proposal.revision,
      items: proposal.items.map(item => reviewedWikiChoice(item, edits[item.id])),
    };
    if (!applyPending && !input.items.some(item => item.selected)) { setNotice({ error: true, text: "请至少选择一项待采用的更新。" }); return; }
    if (input.items.some(item => item.selected && (!item.title.trim() || !item.body.trim()))) { setNotice({ error: true, text: "已选择的更新需要标题与整理正文。你的修改仍保留。" }); return; }
    applyRequest.current = input;
    const ticket = beginOperation("apply"); setNotice(null);
    try {
      const value = await command("wiki-apply", input);
      if (!canPresent(ticket)) return;
      reviewDrafts.current.delete(proposal.id);
      setProposal(value); setEdits(proposalDraft(value));
      const pending = Boolean(value.pendingApproval) || ["unknown", "applying"].includes(value.state);
      setApplyPending(pending);
      applyRequest.current = pending ? value.pendingApproval || input : null;
      setNotice({ error: pending || value.state === "conflict", text: pending
        ? "部分采用结果尚待核对。已完成的项目会保留，请核对原操作后再继续。"
        : value.state === "conflict" ? "部分卡片出现版本冲突。已有修改受到保护；请阅读最新卡片，再从原资料生成新的提案。"
          : "本次采用已完成。可打开卡片，尝试回想并写下自己的理解。" });
      await refreshAfterSuccess(ticket);
    } catch (error) {
      if (!canPresent(ticket)) return;
      const pending = uncertain(error);
      setApplyPending(pending);
      if (!pending) applyRequest.current = null;
      setNotice({ error: true, text: pending ? `${note(error, "采用结果尚未确认。")} 请核对同一提案，不要重新创建写入请求。` : note(error, "本次采用未完成，审阅内容仍保留。") });
    } finally { finishOperation(ticket); }
  }
  const recoverRequests = useRef(new Map());
  async function recoverItem(item) {
    if (!proposal || busy || !authenticated) return;
    const backup = item.op_id || item.result?.op_id;
    const expectedHash = item.result?.managedHash || item.result?.hash || item.result?.expected_hash;
    if (!backup) return;
    const input = recoverRequests.current.get(item.id) || {
      op_id: operationId("wiki_recover"), backup_op_id: backup,
      ...(expectedHash ? { expected_hash: expectedHash } : {}),
    };
    recoverRequests.current.set(item.id, input); const ticket = beginOperation("recover"); setNotice(null);
    try {
      await command("wiki-recover", input);
      recoverRequests.current.delete(item.id);
      const value = await command("wiki-proposal", { id: proposal.id });
      if (!canPresent(ticket)) return;
      setProposal(value); setEdits(proposalDraft(value)); await refreshAfterSuccess(ticket);
      if (canPresent(ticket)) setNotice({ text: "已按受保护回执恢复该项，后续用户修改不会被覆盖。" });
    } catch (error) { if (canPresent(ticket)) setNotice({ error: true, text: note(error, "恢复尚未完成。请保留原回执，核对后重试同一次恢复。") }); }
    finally { finishOperation(ticket); }
  }
  const locked = Boolean(busy) || !authenticated;
  return <section className="wiki-page" id="wiki-page" hidden={!active} aria-labelledby="wiki-heading" aria-busy={Boolean(busy)}>
    <header className="wiki-page-heading">
      <Title id="wiki-heading" level={1}>资料与知识整理</Title>
      <Paragraph type="secondary">保留原文，审阅新的联系，再把理解写回知识卡。</Paragraph>
    </header>
    <Flex gap={12} align="center" justify="space-between" className="wiki-navigation">
      <Radio.Group aria-label="知识整理页面" value={tab} onChange={event => { operations.current.changeView(`tab:${event.target.value}`); setTab(event.target.value); setNotice(null); }}>
        <Radio.Button value="sources">来源资料</Radio.Button><Radio.Button value="proposals">整理提案</Radio.Button><Radio.Button value="events">采用记录</Radio.Button>
      </Radio.Group>
      <Button icon={<ReloadOutlined />} htmlType="button" disabled={locked} onClick={() => void refreshVisibleLists()}>刷新列表</Button>
    </Flex>
    <Notice value={notice} />
    {busy === "generate" && <Paragraph className="wiki-working" role="status"><Spin size="small" /> 正在对照原文与已有知识生成提案，卡片尚未改变…</Paragraph>}
    <div hidden={tab !== "sources"}>
      <div className="wiki-source-layout">
        <section className="wiki-import" aria-labelledby="wiki-import-heading">
          <Title id="wiki-import-heading" level={2}>保存一份原始资料</Title>
          <Form id="wiki-source-form" layout="vertical" onFinish={() => void importSource()} aria-labelledby="wiki-import-heading">
            <Form.Item label="资料标题" htmlFor={`${uid}-source-title`} required validateStatus={sourceErrors.title ? "error" : undefined} help={sourceErrors.title}>
              <Input ref={titleRef} id={`${uid}-source-title`} name="title" required maxLength={1000} value={draft.title} readOnly={locked || importPending} onChange={event => setSourceField("title", event.target.value)} />
            </Form.Item>
            <div className="wiki-fields-row">
              <Form.Item label="出处链接（可选）" htmlFor={`${uid}-source-url`} validateStatus={sourceErrors.url ? "error" : undefined} help={sourceErrors.url}>
                <Input ref={urlRef} id={`${uid}-source-url`} name="url" type="url" autoComplete="url" spellCheck={false} autoCapitalize="none" value={draft.url} readOnly={locked || importPending} onChange={event => setSourceField("url", event.target.value)} />
              </Form.Item>
              <Form.Item label="作者（可选）" htmlFor={`${uid}-source-author`}>
                <Input id={`${uid}-source-author`} name="author" maxLength={1000} value={draft.author} readOnly={locked || importPending} onChange={event => setSourceField("author", event.target.value)} />
              </Form.Item>
            </div>
            <Form.Item label="保存为哪个来源的新版本" htmlFor={`${uid}-source-version`} extra="独立资料保持“新资料”；选择已有来源会新增快照，不覆盖旧原文。">
              <Select id={`${uid}-source-version`} value={draft.sourceId || ""} disabled={locked || importPending} onChange={value => setSourceField("sourceId", value)}
                options={[{ value: "", label: "新资料" }, ...sourceGroups.map(item => ({ value: item.sourceId, label: `${item.title}（已保存版本 ${item.version}）` }))]} />
            </Form.Item>
            <Form.Item label="原始正文" htmlFor={`${uid}-source-body`} required validateStatus={sourceErrors.markdown ? "error" : undefined} help={sourceErrors.markdown}>
              <Input.TextArea ref={bodyRef} id={`${uid}-source-body`} name="markdown" required rows={12} value={draft.markdown} readOnly={locked || importPending}
                aria-describedby={`${uid}-source-limits`} onChange={event => setSourceField("markdown", event.target.value)} placeholder="粘贴文章、摘录或 Markdown 原文。保存原文后，再选择是否让模型整理。" />
            </Form.Item>
            <Flex gap={12} align="center" wrap className="wiki-import-actions">
              <input ref={uploadRef} type="file" accept=".md,.markdown,.txt,text/plain,text/markdown" hidden disabled={locked || importPending} onChange={event => { void readFile(event.target.files?.[0]); event.target.value = ""; }} />
              <Button htmlType="button" icon={<UploadOutlined />} disabled={locked || importPending} onClick={() => uploadRef.current?.click()}>读取文本文件</Button>
              <Button id="wiki-save-source" type="primary" htmlType="submit" disabled={locked} loading={busy === "import"}>{importPending ? "核对导入结果" : "保存原始资料"}</Button>
              <Text id={`${uid}-source-limits`} type={length > SOURCE_LIMIT ? "danger" : "secondary"}>{length.toLocaleString()} / 200,000 字符 · 文件不超过 1 MiB</Text>
            </Flex>
          </Form>
        </section>
        <aside className="wiki-source-list" aria-labelledby="wiki-source-list-heading">
          <Title id="wiki-source-list-heading" level={2}>已保存的来源</Title>
          {!sources.length ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="还没有来源资料" /> : <ul>{sources.map(item => <li key={item.id}>
            <button type="button" disabled={locked} aria-current={source?.id === item.id ? "true" : undefined} onClick={() => void openSource(item.id)}>
              <FileTextOutlined /><span>{sourceLabel(item)}<small>{timeText(item.createdAt)}</small></span>
            </button>
          </li>)}</ul>}
        </aside>
      </div>
      {source && <div className="wiki-selected-source">
        <SourceText source={source} />
        <div className="wiki-generation-action">
          <Paragraph type="secondary">生成提案会把这份原文及有限的相关卡片内容发送至已配置的模型。模型将提出更新，不会直接修改知识卡。</Paragraph>
          {modelView?.configured && <Paragraph id="wiki-model-destination"><Text strong>本次模型</Text> {modelView.model} · <Text type="secondary">{modelView.baseUrl}</Text></Paragraph>}
          {modelViewError && <Paragraph type="danger" role="status">{modelViewError}</Paragraph>}
          <Paragraph type="secondary">单次整理最多 20,000 字符；保存原文与整理内容是两个独立步骤。</Paragraph>
          {!askAvailable && <Paragraph>请先在页头的“模型设置”中配置可用服务。</Paragraph>}
          <Button id="wiki-generate-proposal" type="primary" htmlType="button" loading={busy === "generate"} disabled={locked || !askAvailable} onClick={() => void generateProposal()}>生成整理提案</Button>
        </div>
      </div>}
    </div>
    <section hidden={tab !== "proposals"} className="wiki-proposals" aria-labelledby="wiki-proposals-heading">
      <Title id="wiki-proposals-heading" level={2}>审阅整理提案</Title>
      <Form.Item label="选择提案" htmlFor={`${uid}-proposal-choice`}>
        <Select id={`${uid}-proposal-choice`} value={proposal?.id} placeholder="选择一份提案" disabled={locked} onChange={id => void openProposal(id)}
          options={proposals.map(item => ({ value: item.id, label: `${sources.find(s => s.id === item.sourceId)?.title || "资料整理"} · ${statusText(item.state)} · ${timeText(item.createdAt)}` }))} />
      </Form.Item>
      {!proposal ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="从一份已保存的资料生成提案，再在这里查看更新依据。" /> : <>
        <Flex align="baseline" gap={12} wrap><Tag>{statusText(proposal.state)}</Tag><Text type="secondary">{timeText(proposal.createdAt)}</Text>
          <Button type="link" htmlType="button" disabled={locked} onClick={() => void openSource(proposal.sourceId)}>查看本次原文</Button>
        </Flex>
        <Form id="wiki-review-form" layout="vertical" onFinish={() => void adoptProposal()} aria-labelledby="wiki-proposals-heading">
          <div className="wiki-proposal-items">{proposal.items.map((item, index) => {
            const edit = edits[item.id] || item;
            const pending = item.status === "pending" || !item.status;
            const itemLocked = locked || applyPending || !pending;
            return <section className="wiki-proposal-item" key={item.id} aria-labelledby={`${uid}-item-${index}`}>
              <header className="wiki-proposal-item-heading">
                <Title id={`${uid}-item-${index}`} level={3}>{item.kind === "update" ? "更新已有卡片" : "新增知识卡"} · {item.title}</Title>
                <Tag>{statusText(item.status)}</Tag>
              </header>
              <Paragraph>{item.reason}</Paragraph>
              {item.cardId && <Button htmlType="button" type="link" className="wiki-card-link" onClick={() => onOpenCard?.(item.cardId)}>打开当前卡片</Button>}
              {item.before?.markdown && <details className="wiki-disclosure"><summary>生成提案时的原卡内容</summary><pre className="wiki-source-text">{item.before.markdown}</pre></details>}
              <details className="wiki-disclosure wiki-quotes" open><summary>原文依据（请核对解释是否成立）</summary>
                {(item.quotes || []).map((quote, quoteIndex) => <blockquote key={quoteIndex}><p>{quote.quote}</p>
                  <button type="button" onClick={() => void openSource(quote.sourceId)} disabled={locked}>查看引用来源</button></blockquote>)}
              </details>
              <Form.Item label={item.kind === "update" ? "原卡标题（保留）" : "卡片标题"} htmlFor={`${uid}-title-${index}`}><Input id={`${uid}-title-${index}`} name={`title-${index}`} value={item.kind === "update" ? item.before?.title || item.title : edit.title} readOnly={itemLocked || item.kind === "update"} maxLength={1000} onChange={event => setItem(item.id, { title: event.target.value })} /></Form.Item>
              <Form.Item label="回想问题（可选）" htmlFor={`${uid}-question-${index}`}><Input.TextArea id={`${uid}-question-${index}`} name={`question-${index}`} rows={2} value={edit.question} readOnly={itemLocked} onChange={event => setItem(item.id, { question: event.target.value })} /></Form.Item>
              <Form.Item label="本次整理稿（Markdown，可修改）" htmlFor={`${uid}-body-${index}`}><Input.TextArea id={`${uid}-body-${index}`} name={`body-${index}`} rows={8} value={edit.body} readOnly={itemLocked} onChange={event => setItem(item.id, { body: event.target.value })} /></Form.Item>
              {pending && <Checkbox checked={Boolean(edit.selected)} disabled={locked || applyPending} onChange={event => setItem(item.id, { selected: event.target.checked })}>采用这项更新</Checkbox>}
              {item.error && <Alert className="wiki-item-error" type="error" title={typeof item.error === "string" ? item.error : item.error.message || "该项尚未完成，请核对操作结果。"} />}
              {(item.result?.cardId || item.result?.id || item.cardId) && item.status === "applied" && <Flex gap={12} wrap>
                <Button htmlType="button" onClick={() => onOpenCard?.(item.result?.cardId || item.result?.id || item.cardId)}>打开卡片并回想</Button>
                {(item.op_id || item.result?.op_id) && <Button htmlType="button" disabled={locked} onClick={() => void recoverItem(item)}>恢复这项采用前的内容</Button>}
              </Flex>}
              {(item.status === "unknown" || item.status === "conflict") && item.op_id && <Paragraph className="wiki-operation-reference" type="secondary">操作回执：<code>{item.op_id}</code>。{item.status === "conflict" ? "请读取最新卡片后重新整理，后续修改会保留。" : "请核对当前提案，继续同一次操作。"}</Paragraph>}
            </section>;
          })}</div>
          <div className="wiki-adopt-action">
            <Paragraph type="secondary">采用会逐项保存并读回。若中途发生冲突或结果未知，已完成项目保留，其余项目等待核对。你的理解与原有内容受到保护。</Paragraph>
            <Button id="wiki-adopt-proposal" type="primary" htmlType="submit" loading={busy === "apply"} disabled={locked}>{applyPending ? "核对并继续采用" : "采用已选择的更新"}</Button>
          </div>
        </Form>
      </>}
    </section>
    <section hidden={tab !== "events"} aria-labelledby="wiki-events-heading" className="wiki-events">
      <Title id="wiki-events-heading" level={2}>知识如何变化</Title>
      {!events.length ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="采用资料或保存理解后，记录会显示在这里。" /> : <ol>{events.map((event, index) => <li key={event.id || index}>
        <div><Text strong>{event.title || event.summary || ({ "source-imported": "保存原始资料", "proposal-created": "生成整理提案", "item-applied": "采用知识更新", "understanding-saved": "保存自己的理解", "item-recovered": "恢复采用前内容" })[event.kind] || "知识记录"}</Text>
          {event.createdAt || event.at ? <time>{timeText(event.createdAt || event.at)}</time> : null}</div>
        {event.cardId && <Button type="link" htmlType="button" onClick={() => onOpenCard?.(event.cardId)}>打开相关卡片</Button>}
        {event.sourceId && <Button type="link" htmlType="button" onClick={() => void openSource(event.sourceId)}>查看来源</Button>}
      </li>)}</ol>}
    </section>
  </section>;
}

export function RecallPanel({ command, current, active, authenticated, onDirtyChange, onSaved, children }) {
  const uid = useId().replaceAll(":", "");
  const id = current?.id;
  const [info, setInfo] = useState(null);
  const [infoId, setInfoId] = useState(null);
  const [loading, setLoading] = useState(false);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null);
  const [revision, setRevision] = useState(0);
  const drafts = useRef(new Map());
  const requests = useRef(new Map());
  const pending = useRef(new Set());
  const operations = useRef(null);
  if (!operations.current) operations.current = createWikiOperations({ active: active && authenticated, key: id || "" });
  const dirtyCallback = useRef(onDirtyChange);
  dirtyCallback.current = onDirtyChange;
  const currentId = useRef(id);
  currentId.current = id;
  const dirty = Boolean(text.trim()) || busy || pending.current.has(id);
  useLayoutEffect(() => { operations.current.setView({ active: active && authenticated, key: id || "" }); }, [active, authenticated, id]);
  useEffect(() => { dirtyCallback.current?.(Boolean(active && dirty)); }, [active, dirty, id]);
  useEffect(() => () => dirtyCallback.current?.(false), []);
  useEffect(() => {
    setText(drafts.current.get(id) || ""); setInfo(null); setInfoId(null); setMessage(null);
  }, [id]);
  useEffect(() => {
    if (!active || !authenticated || !id) return;
    let valid = true;
    const ticket = operations.current.begin("card-context");
    setLoading(true);
    command("wiki-card", { id }).then(value => { if (valid && operations.current.isCurrent(ticket)) { setInfo(value); setInfoId(id); } })
      .catch(error => { if (valid && operations.current.isCurrent(ticket)) { setInfoId(id); setMessage({ error: true, text: note(error, "回想信息暂时无法读取。你仍可阅读正文。"), reload: true }); } })
      .finally(() => {
        if (valid && operations.current.isCurrent(ticket)) setLoading(false);
        operations.current.finish(ticket);
      });
    return () => { valid = false; operations.current.finish(ticket); };
  }, [active, authenticated, id, current?.revision, revision, command]);
  function changeText(value) {
    if (pending.current.has(id)) return;
    drafts.current.set(id, value); requests.current.delete(id); setText(value); setMessage(null);
  }
  async function saveUnderstanding(event) {
    event?.preventDefault?.();
    if (!id || busy || !authenticated) return;
    const input = requests.current.get(id) || { id, op_id: operationId("understanding"), expected_revision: info?.revision || current.revision, text };
    if (!input.text.trim()) { setMessage({ error: true, text: "先写下一句自己的理解或应用例子，再保存。" }); return; }
    if (Array.from(input.text).length > 12000) { setMessage({ error: true, text: "这段理解超过 12,000 字符，完整输入仍保留，请精简或拆分后保存。" }); return; }
    requests.current.set(id, input);
    const ticket = operations.current.begin("understanding");
    setBusy(operations.current.hasMutation()); setMessage(null);
    try {
      await command("wiki-understanding", input);
      if (requests.current.get(id) === input) { pending.current.delete(id); requests.current.delete(id); }
      if (drafts.current.get(id) === input.text) drafts.current.delete(id);
      setText(latest => clearSavedUnderstandingDraft({ cardId: currentId.current, text: latest }, { cardId: id, text: input.text }).text);
      if (currentId.current === id && operations.current.isCurrent(ticket)) {
        setMessage({ text: "已保存为你的理解。新的表达会与整理内容分别保留。" }); setRevision(value => value + 1);
        dirtyCallback.current?.(false);
        try { await onSaved?.(); }
        catch (error) { if (operations.current.isCurrent(ticket)) setMessage({ error: true, text: note(error, "理解已保存，卡片暂时未能刷新。你的保存结果不受影响。"), reload: true }); }
      }
    } catch (error) {
      if (uncertain(error)) pending.current.add(id);
      else { pending.current.delete(id); requests.current.delete(id); }
      if (currentId.current === id && operations.current.isCurrent(ticket)) setMessage({ error: true, text: uncertain(error) ? `${note(error, "暂时无法确认保存结果。")} 请核对同一次保存，输入仍保留。` : note(error, "保存未完成，你的输入仍保留。"), reload: ["content_conflict", "version_conflict", "revision_conflict"].includes(error.code) });
    } finally { operations.current.finish(ticket); setBusy(operations.current.hasMutation()); }
  }
  const locked = !authenticated || busy || pending.current.has(id);
  const awaitingInfo = Boolean(id && (loading || infoId !== id));
  const question = infoId === id ? info?.question : "";
  const understandingInput = <Form.Item label={question ? "先用自己的话解释，也可以写一个应用例子" : "写下自己的解释或应用例子"} htmlFor={`${uid}-understanding`}>
    <Input.TextArea id={`${uid}-understanding`} name="understanding" rows={4} value={text} readOnly={locked}
      placeholder="这条知识让我想到什么？它适用于我的哪件事，又有什么边界？" onChange={event => changeText(event.target.value)} />
  </Form.Item>;
  return <div className="wiki-recall" hidden={!active} aria-busy={busy || loading}>
    {awaitingInfo && <Paragraph className="wiki-working" role="status"><Spin size="small" /> 正在读取回想问题…</Paragraph>}
    {!awaitingInfo && question && <>
      <section className="wiki-recall-question" aria-labelledby={`${uid}-question-heading`}>
        <Title id={`${uid}-question-heading`} level={2}>先试着回想</Title>
        <Paragraph className="wiki-question-text">{question}</Paragraph>
        <Text type="secondary">可以先口头解释，也可以写一句自己的理解，然后展开对照。</Text>
      </section>
    </>}
    <section className="wiki-understanding" aria-labelledby={`${uid}-understanding-heading`}>
      <Title id={`${uid}-understanding-heading`} level={2}>我的理解</Title>
      <Form id={`wiki-understanding-${uid}`} layout="vertical" aria-labelledby={`${uid}-understanding-heading`} onFinish={saveUnderstanding}>
        {!awaitingInfo && question && understandingInput}
        {!awaitingInfo && question ? <details className="wiki-reference" key={id}>
          <summary>展开参考解释、例子与来源</summary>
          <div className="wiki-reference-content">{children}</div>
        </details> : !awaitingInfo ? children : null}
        {!awaitingInfo && !question && understandingInput}
        <Flex align="center" gap={12} wrap>
          <Button id="wiki-save-understanding" type="primary" htmlType="submit" disabled={!authenticated || busy || awaitingInfo || info?.canWrite === false} loading={busy}>{pending.current.has(id) ? "核对理解保存结果" : "保存为我的理解"}</Button>
          <Text type="secondary">仅在点击保存后写入；没有评分、排程或自动提交。</Text>
        </Flex>
      </Form>
      <Notice value={message} />
      {message?.reload && <Button htmlType="button" onClick={() => { setRevision(value => value + 1); void onSaved?.(); }}>重新读取，保留当前输入</Button>}
      {(info?.understandings || []).length > 0 && <div className="wiki-understanding-history">
        <Title level={3}>以前写下的理解</Title>
        <ol>{info.understandings.map((entry, index) => <li key={entry.id || index}>
          {entry.createdAt && <time>{timeText(entry.createdAt)}</time>}<p>{entry.text}</p>
        </li>)}</ol>
      </div>}
    </section>
    {(info?.sources || []).length > 0 && <details className="wiki-disclosure wiki-card-sources"><summary>这张卡片使用的原始资料</summary>
      <ul>{info.sources.map((source, index) => <li key={`${source.id}-${index}`}>
        <a href={`/wiki?source=${encodeURIComponent(source.id)}`}>{source.title || "查看原始资料"}</a>
        {source.quote && <blockquote>{source.quote}</blockquote>}
      </li>)}</ul>
    </details>}
  </div>;
}
