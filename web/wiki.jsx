import React, { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Alert, Button, Empty, Flex, Form, Input, Select, Spin, Typography } from 'antd';
import { UploadOutlined } from '@ant-design/icons';
import { createWikiOperations, decodeWikiSource } from './wiki-async.mjs';
import './wiki.css';

const { Title, Text, Paragraph } = Typography;
const SOURCE_LIMIT = 200000;
const SOURCE_BYTES = 1024 * 1024;
const emptySource = () => ({ title: '', markdown: '', url: '', author: '' });
const note = (error, fallback) => error?.status === 401 ? '访问已过期。重新登录后，你的输入仍会保留。' : error?.message || fallback;
const uncertain = error => error?.status === 401 || error?.status >= 500 || ['transport_unknown', 'operation_pending', 'readback_conflict'].includes(error?.code);
const sourceLabel = source => `${source.title || '未命名资料'}${source.version ? ` · 第 ${source.version} 版` : ''}`;
function safeURL(value) { try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) ? url.href : null; } catch { return null; } }
function Notice({ value }) { return <div className="wiki-notice" role="status" aria-live="polite">{value && <Alert type={value.error ? 'error' : 'info'} title={value.text} />}</div>; }

export function WikiPage({ command, active, authenticated, draftAvailable, onOpenDraft, onDirtyChange, initialSourceId, readModelSettings }) {
  const uid = useId().replaceAll(':', '');
  const [sources, setSources] = useState([]);
  const [source, setSource] = useState(null);
  const [draft, setDraft] = useState(emptySource);
  const [generated, setGenerated] = useState(null);
  const [targetId, setTargetId] = useState('');
  const [cardQuery, setCardQuery] = useState('');
  const [cards, setCards] = useState([]);
  const [busy, setBusy] = useState('');
  const [notice, setNotice] = useState(null);
  const [errors, setErrors] = useState({});
  const [modelView, setModelView] = useState(null);
  const [importPending, setImportPending] = useState(false);
  const [archives, setArchives] = useState(null);
  const [archive, setArchive] = useState(null);
  const importRequest = useRef(null);
  const operations = useRef(null);
  if (!operations.current) operations.current = createWikiOperations({ active: active && authenticated, key: initialSourceId || '' });
  const uploadRef = useRef(null);
  const titleRef = useRef(null);
  const bodyRef = useRef(null);
  const urlRef = useRef(null);
  const dirtyCallback = useRef(onDirtyChange);
  dirtyCallback.current = onDirtyChange;
  const length = useMemo(() => Array.from(draft.markdown).length, [draft.markdown]);
  const sourceDirty = Boolean(draft.title || draft.markdown || draft.url || draft.author);
  const dirty = sourceDirty || Boolean(generated) || ['import', 'generate', 'file', 'open'].includes(busy) || importPending;
  useLayoutEffect(() => { operations.current.setView({ active: active && authenticated, key: initialSourceId || '' }); }, [active, authenticated, initialSourceId]);
  useEffect(() => { dirtyCallback.current?.(Boolean(active && dirty)); }, [active, dirty]);
  useEffect(() => () => dirtyCallback.current?.(false), []);
  function begin(kind, key) { if (key !== undefined) operations.current.changeView(key); const ticket = operations.current.begin(kind); setBusy(operations.current.busy()); return ticket; }
  function finish(ticket) { operations.current.finish(ticket); setBusy(operations.current.busy()); }
  const current = ticket => operations.current.isCurrent(ticket);
  useEffect(() => {
    if (!active || !authenticated) return;
    let valid = true;
    command('sources-list', {}).then(value => { if (valid) setSources(value.items || []); }).catch(error => { if (valid) setNotice({ error: true, text: note(error, '来源暂时无法读取。') }); });
    readModelSettings().then(value => { if (valid) setModelView(value); }).catch(error => { if (valid) setNotice({ error: true, text: note(error, '暂时无法读取模型设置。') }); });
    return () => { valid = false; };
  }, [active, authenticated, command, readModelSettings]);
  useEffect(() => {
    if (!active || !authenticated) return;
    let valid = true;
    const timer = setTimeout(() => {
      command('list', { query: cardQuery.trim(), limit: 100, offset: 0 }).then(value => { if (valid) setCards(value.items || []); })
        .catch(error => { if (valid) setNotice({ error: true, text: note(error, '目标卡片暂时无法读取，请重试搜索。') }); });
    }, 250);
    return () => { valid = false; clearTimeout(timer); };
  }, [active, authenticated, cardQuery, command]);
  async function openSource(id) {
    const ticket = begin('source', `source:${id}`);
    try { const value = await command('source-get', { id }); if (current(ticket)) { setSource(value); setNotice(null); } }
    catch (error) { if (current(ticket)) setNotice({ error: true, text: note(error, '原文暂时无法读取。') }); }
    finally { finish(ticket); }
  }
  useEffect(() => { if (active && authenticated && initialSourceId) void openSource(initialSourceId); }, [active, authenticated, initialSourceId]);
  function setField(field, value) { if (importPending) return; importRequest.current = null; setDraft(old => ({ ...old, [field]: value })); setErrors(old => ({ ...old, [field]: undefined })); }
  async function readFile(file) {
    if (!file) return;
    if (!/\.(?:md|markdown|txt)$/i.test(file.name) || file.size > SOURCE_BYTES) { setNotice({ error: true, text: '请选择不超过 1 MiB 的 Markdown 或 UTF-8 文本文件。当前草稿未改动。' }); return; }
    const ticket = begin('file');
    try {
      const markdown = decodeWikiSource(await file.arrayBuffer());
      if (markdown.includes('\u0000')) throw new Error('文件含有无法保存的字符，请转换为 UTF-8 文本后重试。');
      if (!current(ticket)) return;
      importRequest.current = null;
      setDraft(old => ({ ...old, markdown, title: old.title || file.name.replace(/\.(?:md|markdown|txt)$/i, '') }));
      setNotice({ text: '文件已完整读入。检查后点击“保存原始资料”。' });
    } catch (error) { if (current(ticket)) setNotice({ error: true, text: note(error, '文件读取失败，当前草稿仍保留。') }); }
    finally { finish(ticket); }
  }
  function validateSource() {
    const next = {};
    if (!draft.title.trim()) next.title = '请填写资料标题。';
    if (!draft.markdown.trim()) next.markdown = '请粘贴正文或选择文本文件。';
    else if (length > SOURCE_LIMIT || new TextEncoder().encode(draft.markdown).byteLength > SOURCE_BYTES) next.markdown = '正文超过 200,000 字符或 1 MiB，请拆分后保存。完整输入仍保留。';
    if (draft.url && !safeURL(draft.url)) next.url = '出处需为 http 或 https 地址，也可以留空。';
    setErrors(next);
    if (next.title) titleRef.current?.focus(); else if (next.markdown) bodyRef.current?.focus(); else if (next.url) urlRef.current?.focus();
    return !Object.keys(next).length;
  }
  async function importSource() {
    if (busy || !authenticated || (!importPending && !validateSource())) return;
    const input = importRequest.current || { op_id: `source_${crypto.randomUUID().replaceAll('-', '')}`, title: draft.title.trim(), markdown: draft.markdown,
      ...(draft.url.trim() ? { url: draft.url.trim() } : {}), ...(draft.author.trim() ? { author: draft.author.trim() } : {}) };
    importRequest.current = input;
    const ticket = begin('import'); setNotice(null);
    try {
      const saved = await command('source-import', input);
      if (!current(ticket)) return;
      setSource(saved); setDraft(emptySource()); setImportPending(false); importRequest.current = null;
      setSources(old => [saved, ...old.filter(item => item.id !== saved.id)]);
      setNotice({ text: '原文快照已保存。选择目标后可生成一张卡片的整理稿。' });
    } catch (error) { setImportPending(uncertain(error)); if (current(ticket)) setNotice({ error: true, text: uncertain(error) ? `${note(error, '导入结果尚未确认。')} 请使用“核对导入结果”继续同一次保存。` : note(error, '原文尚未保存，输入仍保留。') }); }
    finally { finish(ticket); }
  }
  async function generateDraft() {
    if (!source || busy || generated || !authenticated || !draftAvailable) return;
    if (Array.from(source.markdown).length > 20000) { setNotice({ error: true, text: '原文已完整保存。单次整理最多 20,000 字符，请另存选段后再生成。' }); return; }
    const ticket = begin('generate'); setNotice(null);
    try {
      const settings = await readModelSettings();
      if (!current(ticket)) return;
      setModelView(settings);
      if (!settings.configured) throw new Error('请先在页头模型设置中保存可用接口。');
      const value = await command('wiki-draft', { sourceId: source.id, ...(targetId ? { cardId: targetId } : {}) });
      if (current(ticket)) { setGenerated(value); setNotice({ text: '整理稿已生成，知识卡尚未改变。检查正文和原文引用，再放入编辑器。' }); }
    } catch (error) { if (current(ticket)) setNotice({ error: true, text: note(error, '整理未完成，原文仍保留。') }); }
    finally { finish(ticket); }
  }
  async function openDraft() {
    if (!generated || busy || !authenticated) return;
    if (sourceDirty) { setNotice({ error: true, text: '请先保存上方尚未保存的资料输入，再打开整理稿。' }); return; }
    const ticket = begin('open');
    try { if (await onOpenDraft(generated)) setGenerated(null); }
    catch (error) { if (current(ticket)) setNotice({ error: true, text: note(error, '编辑器未能打开，整理稿仍保留。') }); }
    finally { finish(ticket); }
  }
  async function readArchives() {
    if (archives || busy || !authenticated) return;
    const ticket = begin('archive');
    try { const value = await command('wiki-proposals', {}); if (current(ticket)) setArchives(value.items || []); }
    catch (error) { if (current(ticket)) setNotice({ error: true, text: note(error, '历史提案暂时无法读取。') }); }
    finally { finish(ticket); }
  }
  async function openArchive(id) {
    const ticket = begin('archive');
    try { const value = await command('wiki-proposal', { id }); if (current(ticket)) setArchive(value); }
    catch (error) { if (current(ticket)) setNotice({ error: true, text: note(error, '历史提案暂时无法读取。') }); }
    finally { finish(ticket); }
  }
  const locked = Boolean(busy) || !authenticated;
  return <section className="wiki-page" id="wiki-page" hidden={!active} aria-labelledby="wiki-heading" aria-busy={Boolean(busy)}>
    <header className="wiki-page-heading"><Title id="wiki-heading" level={1}>资料与整理</Title><Paragraph type="secondary">保存原文，整理成一张卡片，再用自己的话继续写。</Paragraph></header>
    <Notice value={notice} />
    <details className="wiki-disclosure" open={!source}>
      <summary>保存一份新资料</summary>
      <Form id="wiki-source-form" className="wiki-import" layout="vertical" onFinish={importSource} aria-labelledby={`${uid}-import-heading`}>
        <Title id={`${uid}-import-heading`} level={2}>原始资料</Title>
        <Form.Item label="资料标题" htmlFor={`${uid}-source-title`} required validateStatus={errors.title ? 'error' : undefined} help={errors.title}>
          <Input ref={titleRef} id={`${uid}-source-title`} name="title" required maxLength={1000} value={draft.title} readOnly={locked || importPending} aria-invalid={Boolean(errors.title)} onChange={event => setField('title', event.target.value)} />
        </Form.Item>
        <Form.Item label="原始正文" htmlFor={`${uid}-source-body`} required validateStatus={errors.markdown ? 'error' : undefined} help={errors.markdown}>
          <Input.TextArea ref={bodyRef} id={`${uid}-source-body`} name="markdown" required rows={10} value={draft.markdown} readOnly={locked || importPending} aria-invalid={Boolean(errors.markdown)} aria-describedby={`${uid}-source-limits`} onChange={event => setField('markdown', event.target.value)} />
        </Form.Item>
        <details className="wiki-disclosure"><summary>出处与作者（可选）</summary>
          <Form.Item label="出处链接" htmlFor={`${uid}-source-url`} validateStatus={errors.url ? 'error' : undefined} help={errors.url}>
            <Input ref={urlRef} id={`${uid}-source-url`} name="url" type="url" value={draft.url} readOnly={locked || importPending} spellCheck={false} autoCapitalize="none" aria-invalid={Boolean(errors.url)} onChange={event => setField('url', event.target.value)} />
          </Form.Item>
          <Form.Item label="作者" htmlFor={`${uid}-source-author`}><Input id={`${uid}-source-author`} name="author" maxLength={500} value={draft.author} readOnly={locked || importPending} onChange={event => setField('author', event.target.value)} /></Form.Item>
        </details>
        <Flex wrap gap={12} align="center">
          <input ref={uploadRef} type="file" accept=".md,.markdown,.txt,text/plain,text/markdown" hidden disabled={locked || importPending} onChange={event => { void readFile(event.target.files?.[0]); event.target.value = ''; }} />
          <Button htmlType="button" icon={<UploadOutlined />} disabled={locked || importPending} onClick={() => uploadRef.current?.click()}>读取文本文件</Button>
          <Button id="wiki-save-source" type="primary" htmlType="submit" disabled={locked} loading={busy === 'import'}>{importPending ? '核对导入结果' : '保存原始资料'}</Button>
          <Text id={`${uid}-source-limits`} type={length > SOURCE_LIMIT ? 'danger' : 'secondary'}>{length.toLocaleString()} / 200,000 字符 · 不超过 1 MiB</Text>
        </Flex>
      </Form>
    </details>
    <Form.Item label="已保存的来源" htmlFor={`${uid}-source-choice`} className="wiki-source-choice">
      <Select id={`${uid}-source-choice`} showSearch optionFilterProp="label" value={source?.id} placeholder="选择一份原文" disabled={locked || Boolean(generated)} onChange={id => void openSource(id)} options={sources.map(item => ({ value: item.id, label: sourceLabel(item) }))} />
    </Form.Item>
    {!sources.length && !source && <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="先保存一份 Markdown 或文本资料" />}
    {source && <div className="wiki-selected-source">
      <Title level={2}>{sourceLabel(source)}</Title>
      <details className="wiki-disclosure"><summary>核对原文与出处</summary>
        {safeURL(source.url) && <Paragraph><a href={safeURL(source.url)} target="_blank" rel="noreferrer noopener">打开出处</a></Paragraph>}
        <pre className="wiki-source-text">{source.markdown}</pre>
      </details>
      <div className="wiki-generation-action">
        <Form.Item label="搜索目标卡片（可选）" htmlFor={`${uid}-card-search`}><Input.Search id={`${uid}-card-search`} name="cardQuery" value={cardQuery} disabled={locked || Boolean(generated)} placeholder="按标题或正文缩小范围" onChange={event => setCardQuery(event.target.value)} /></Form.Item>
        <Form.Item label="整理到哪张卡片" htmlFor={`${uid}-target`} extra="每次只整理一张卡片。候选最多显示 100 张，可用关键词搜索。旧固定字段卡保持只读。">
          <Select id={`${uid}-target`} value={targetId} disabled={locked || Boolean(generated)} onChange={setTargetId} options={[{ value: '', label: '新建知识卡' }, ...cards.map(card => ({ value: card.id, label: card.title }))]} />
        </Form.Item>
        <Paragraph type="secondary">生成会发送这份原文及所选卡片正文，最多整理 20,000 字符原文；不会自动保存卡片。</Paragraph>
        {modelView?.configured ? <Paragraph id="wiki-model-destination"><Text strong>模型</Text> {modelView.model} · {modelView.baseUrl}</Paragraph> : <Paragraph>请先在页头“模型设置”中配置可用服务。</Paragraph>}
        <Button id="wiki-generate-draft" type="primary" htmlType="button" loading={busy === 'generate'} disabled={locked || !draftAvailable || Boolean(generated)} onClick={() => void generateDraft()}>生成单卡整理稿</Button>
      </div>
    </div>}
    {generated && <section className="wiki-draft" aria-labelledby={`${uid}-draft-heading`}>
      <Title id={`${uid}-draft-heading`} level={2}>审阅整理稿</Title>
      <Paragraph>来源：{generated.source.title}。原文引用和链接已放入正文，可逐项核对。</Paragraph>
      <Form.Item label="卡片标题" htmlFor={`${uid}-draft-title`}><Input id={`${uid}-draft-title`} name="draftTitle" maxLength={1000} value={generated.title} readOnly={locked || Boolean(generated.target)} onChange={event => setGenerated(old => ({ ...old, title: event.target.value }))} /></Form.Item>
      <Form.Item label="整理稿（Markdown，可修改）" htmlFor={`${uid}-draft-markdown`}><Input.TextArea id={`${uid}-draft-markdown`} name="draftMarkdown" rows={14} value={generated.markdown} readOnly={locked} onChange={event => setGenerated(old => ({ ...old, markdown: event.target.value }))} /></Form.Item>
      <Paragraph type="secondary">{generated.target ? '将追加到原卡正文之后。原有内容与人的理解会保留。' : '将作为新卡的未保存草稿打开。'}只有在编辑器点击保存后才写入知识库。</Paragraph>
      <Flex wrap gap={12}><Button id="wiki-open-draft" type="primary" htmlType="button" loading={busy === 'open'} disabled={locked || !generated.title.trim() || !generated.markdown.trim()} onClick={() => void openDraft()}>放入编辑器</Button>
        <Button htmlType="button" disabled={locked} onClick={() => { setGenerated(null); setNotice({ text: '整理稿已放弃，原文和知识卡未改变。' }); }}>放弃整理稿，重新选择</Button></Flex>
    </section>}
    <details className="wiki-disclosure wiki-archive" onToggle={event => { if (event.currentTarget.open) void readArchives(); }}><summary>历史整理提案（只读）</summary>
      {archives?.length === 0 && <Paragraph type="secondary">没有历史提案。</Paragraph>}
      {archives?.length > 0 && <Select aria-label="选择历史提案" placeholder="选择一份历史提案" disabled={locked} onChange={id => void openArchive(id)} options={archives.map(item => ({ value: item.id, label: `${sources.find(s => s.id === item.sourceId)?.title || '历史资料'} · ${item.createdAt}` }))} />}
      {archive && <div>{archive.items.map(item => <section key={item.id}><Title level={3}>{item.title}</Title><Paragraph>{item.reason}</Paragraph><pre className="wiki-source-text">{item.body}</pre>{(item.quotes || []).map((quote, index) => <blockquote key={index}>{quote.quote}</blockquote>)}</section>)}</div>}
    </details>
  </section>;
}

export function RecallPanel({ command, current, active, authenticated, onEditUnderstanding, children }) {
  const [info, setInfo] = useState(null);
  const [message, setMessage] = useState(null);
  const key = `${current?.id || ''}:${current?.revision || ''}`;
  useEffect(() => {
    setInfo(null); setMessage(null);
    if (!active || !authenticated || !current?.id) return;
    let valid = true;
    command('wiki-card', { id: current.id }).then(value => { if (valid) setInfo({ key, question: value.question || '' }); })
      .catch(error => { if (valid) { setInfo({ key, question: '' }); setMessage({ error: true, text: note(error, '回想问题暂时无法读取，正文仍可阅读。') }); } });
    return () => { valid = false; };
  }, [active, authenticated, key, command]);
  const awaiting = Boolean(current?.id && info?.key !== key);
  const question = info?.key === key ? info.question : '';
  return <div className="wiki-recall" hidden={!active} aria-busy={awaiting}>
    {awaiting ? <Spin size="small" aria-label="正在读取回想问题" /> : question ? <><section className="wiki-recall-question"><Title level={2}>先试着回想</Title><Paragraph className="wiki-question-text">{question}</Paragraph><Text type="secondary">先用自己的话解释，再展开对照。</Text></section>
      <details className="wiki-reference" key={current?.id}><summary>展开参考解释、例子与来源</summary><div className="wiki-reference-content">{children}</div></details></> : children}
    <Notice value={message} />
    {current?.editable && <div className="wiki-understanding"><Button id="wiki-edit-understanding" htmlType="button" disabled={!authenticated} onClick={onEditUnderstanding}>写我的理解</Button><Text type="secondary"> 在同一个 Markdown 编辑器中继续写，保存后生效。</Text></div>}
  </div>;
}
