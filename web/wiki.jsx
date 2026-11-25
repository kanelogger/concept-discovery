import React, { useEffect, useId, useState } from 'react';
import Alert from "antd/es/alert";
import Button from "antd/es/button";
import Empty from "antd/es/empty";
import Flex from "antd/es/flex";
import Select from "antd/es/select";
import Spin from "antd/es/spin";
import Typography from "antd/es/typography";

const { Title, Text, Paragraph } = Typography;
const sourceLabel = source => source.title + (source.version ? ' · 第 ' + source.version + ' 版' : '');

// Detail readers are keyed by the snapshot ID. A late response belongs only to
// the reader that requested it, including when navigating Back or Forward.
function useWikiRead(command, operation, id) {
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState({});
  useEffect(() => {
    let current = true;
    command(operation, id ? { id } : {}).then(
      data => { if (current) setResult({ data }); },
      error => { if (current) setResult({ error: error.message || '读取失败' }); },
    );
    return () => { current = false; };
  }, [command, operation, id, attempt]);
  return { ...result, retry() { setResult({}); setAttempt(value => value + 1); } };
}

function ReadStatus({ error, retry, label }) {
  if (error) return <Alert className="wiki-notice" type="error" role="alert" title={label + '读取失败'} description={error}
    action={<Button onClick={retry}>重试</Button>} />;
  return <Flex className="wiki-notice" gap={8} align="center" role="status"><Spin size="small" />正在读取{label}…</Flex>;
}

function SourceReader({ command, id }) {
  const result = useWikiRead(command, 'source-get', id);
  const source = result.data;
  if (!source) return <ReadStatus {...result} label="原文" />;
  let url;
  try {
    const value = new URL(source.url);
    if (['https:', 'http:'].includes(value.protocol) && !value.username && !value.password) url = value.href;
  } catch { /* Local sources may have no external URL. */ }
  return <article className="wiki-selected-source">
    <Title level={2}>{source.title}</Title>
    <Flex className="wiki-source-meta" gap={16} wrap>
      {source.author && <Text type="secondary">{source.author}</Text>}
      {source.version && <Text type="secondary">第 {source.version} 版</Text>}
      {url && <a href={url} target="_blank" rel="noreferrer noopener">打开出处</a>}
    </Flex>
    <pre className="wiki-source-text">{source.markdown}</pre>
  </article>;
}

function ProposalReader({ command, id }) {
  const result = useWikiRead(command, 'wiki-proposal', id);
  if (!result.data) return <ReadStatus {...result} label="历史提案" />;
  return result.data.items.map(item => <section key={item.id}>
    <Title level={3}>{item.title}</Title>
    <Paragraph>{item.reason}</Paragraph>
    <pre className="wiki-source-text">{item.body}</pre>
    {(item.quotes || []).map((quote, index) => <blockquote key={index}>{quote.quote}</blockquote>)}
  </section>);
}

function Archives({ command, sources }) {
  const result = useWikiRead(command, 'wiki-proposals');
  const [id, setId] = useState(null);
  if (!result.data) return <ReadStatus {...result} label="历史提案" />;
  if (!result.data.items.length) return <Paragraph type="secondary">没有历史提案。</Paragraph>;
  return <>
    <Select aria-label="选择历史提案" placeholder="选择一份历史提案" value={id} onChange={setId}
      options={result.data.items.map(item => ({ value: item.id, label:
        (sources.find(source => source.id === item.sourceId)?.title || '历史资料') + ' · ' + item.createdAt }))} />
    {id && <ProposalReader key={id} command={command} id={id} />}
  </>;
}

export default function WikiPage({ command, initialSourceId, onSelectSource }) {
  const list = useWikiRead(command, 'sources-list');
  const [historyOpen, setHistoryOpen] = useState(false);
  const selectId = useId();
  const sources = list.data?.items ?? [];
  return <section className="wiki-page" aria-label="资料">
    <Title level={1}>资料</Title>
    {!list.data && <ReadStatus {...list} label="资料列表" />}
    {sources.length > 0 && <div className="wiki-source-choice">
      <label htmlFor={selectId}>选择原文</label>
      <Select id={selectId} aria-label="选择原文" showSearch={{ optionFilterProp: 'label' }}
        value={initialSourceId || undefined} placeholder="按标题查找原文" onChange={onSelectSource}
        options={sources.map(source => ({ value: source.id, label: sourceLabel(source) }))} />
    </div>}
    {list.data && !sources.length && !initialSourceId &&
      <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无资料" />}
    {initialSourceId && <SourceReader key={initialSourceId} command={command} id={initialSourceId} />}
    <details className="wiki-archive" onToggle={event => setHistoryOpen(event.currentTarget.open)}>
      <summary>历史整理提案</summary>
      {historyOpen && <Archives command={command} sources={sources} />}
    </details>
  </section>;
}
