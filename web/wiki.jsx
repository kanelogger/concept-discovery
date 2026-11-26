import React, { useEffect, useId, useState } from "react";
import { Button } from "./components/ui/button.jsx";
export { default as stylesheet } from "./wiki.css?route";

const sourceLabel = source => source.title + (source.version ? " · 第 " + source.version + " 版" : "");

// Detail readers are keyed by the snapshot ID. A late response belongs only to
// the reader that requested it, including when navigating Back or Forward.
function useWikiRead(command, operation, id) {
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState({});
  useEffect(() => {
    let current = true;
    command(operation, id ? { id } : {}).then(
      data => { if (current) setResult({ data }); },
      error => { if (current) setResult({ error: error.message || "读取失败" }); },
    );
    return () => { current = false; };
  }, [command, operation, id, attempt]);
  return { ...result, retry() { setResult({}); setAttempt(value => value + 1); } };
}

function ReadStatus({ error, retry, label }) {
  if (error) return <div className="wiki-notice wiki-error" role="alert">
    <p><strong>{label}读取失败</strong><br />{error}</p>
    <Button onClick={retry}>重试</Button>
  </div>;
  return <p className="wiki-notice" role="status">正在读取{label}…</p>;
}

function SourceReader({ command, id }) {
  const result = useWikiRead(command, "source-get", id);
  const source = result.data;
  if (!source) return <ReadStatus {...result} label="原文" />;
  let url;
  try {
    const value = new URL(source.url);
    if (["https:", "http:"].includes(value.protocol) && !value.username && !value.password) url = value.href;
  } catch { /* Local sources may have no external URL. */ }
  return <article className="wiki-selected-source">
    <h2>{source.title}</h2>
    <div className="wiki-source-meta">
      {source.author && <span>{source.author}</span>}
      {source.version && <span>第 {source.version} 版</span>}
      {url && <a href={url} target="_blank" rel="noreferrer noopener">打开出处</a>}
    </div>
    <pre className="wiki-source-text">{source.markdown}</pre>
  </article>;
}

function ProposalReader({ command, id }) {
  const result = useWikiRead(command, "wiki-proposal", id);
  if (!result.data) return <ReadStatus {...result} label="历史提案" />;
  return result.data.items.map(item => <section key={item.id}>
    <h3>{item.title}</h3>
    <p>{item.reason}</p>
    <pre className="wiki-source-text">{item.body}</pre>
    {(item.quotes || []).map((quote, index) => <blockquote key={index}>{quote.quote}</blockquote>)}
  </section>);
}

function Archives({ command, sources }) {
  const result = useWikiRead(command, "wiki-proposals");
  const [id, setId] = useState("");
  if (!result.data) return <ReadStatus {...result} label="历史提案" />;
  if (!result.data.items.length) return <p className="wiki-notice">没有历史提案。</p>;
  return <>
    <select aria-label="选择历史提案" value={id} onChange={event => setId(event.target.value)}>
      <option disabled value="">选择一份历史提案</option>
      {result.data.items.map(item => <option key={item.id} value={item.id}>
        {(sources.find(source => source.id === item.sourceId)?.title || "历史资料") + " · " + item.createdAt}
      </option>)}
    </select>
    {id && <ProposalReader key={id} command={command} id={id} />}
  </>;
}

function SourceChoice({ sources, selectedId, onSelect }) {
  const filterId = useId();
  const selectId = useId();
  const [filter, setFilter] = useState("");
  const keyword = filter.trim().toLocaleLowerCase();
  const matches = sources.filter(source => sourceLabel(source).toLocaleLowerCase().includes(keyword));
  const value = matches.some(source => source.id === selectedId) ? selectedId : "";
  return <div className="wiki-source-choice">
    <div>
      <label htmlFor={filterId}>按标题查找原文</label>
      <input id={filterId} type="search" value={filter} onChange={event => setFilter(event.target.value)} />
    </div>
    <div>
      <label htmlFor={selectId}>选择原文</label>
      <select id={selectId} value={value} disabled={!matches.length} onChange={event => {
        setFilter("");
        onSelect(event.target.value);
      }}>
        <option disabled value="">{matches.length ? "选择一份原文" : "没有匹配的原文"}</option>
        {matches.map(source => <option key={source.id} value={source.id}>{sourceLabel(source)}</option>)}
      </select>
    </div>
    <span className="visually-hidden" role="status">{keyword && `找到 ${matches.length} 份原文`}</span>
  </div>;
}

export default function WikiPage({ command, initialSourceId, onSelectSource }) {
  const list = useWikiRead(command, "sources-list");
  const [historyOpen, setHistoryOpen] = useState(false);
  const sources = list.data?.items ?? [];
  return <section className="wiki-page" aria-label="资料">
    <h1>资料</h1>
    {!list.data && <ReadStatus {...list} label="资料列表" />}
    {sources.length > 0 && <SourceChoice sources={sources} selectedId={initialSourceId} onSelect={onSelectSource} />}
    {list.data && !sources.length && !initialSourceId && <p className="wiki-empty">暂无资料</p>}
    {initialSourceId && <SourceReader key={initialSourceId} command={command} id={initialSourceId} />}
    <details className="wiki-archive" onToggle={event => setHistoryOpen(event.currentTarget.open)}>
      <summary>历史整理提案</summary>
      {historyOpen && <Archives command={command} sources={sources} />}
    </details>
  </section>;
}
