// Graph inspector adapted from yibie/claude-best-practices-zh, mindmap/graph.html (MIT).
import { useLayoutEffect, useRef } from 'react';

export function relatedCards(layout, node) {
  return (layout.adjacent.get(node.id) || []).map(edge => {
    const outgoing = edge.source === node.id;
    const other = layout.byId.get(outgoing ? edge.target : edge.source);
    return { edge, other, direction: outgoing ? '引用 →' : '← 引用' };
  }).sort((a, b) => b.edge.occurrences.length - a.edge.occurrences.length);
}

export function SidebarDetails({ node, layout, duplicateTitles, onPickEdge, onPick, onRead, popup }) {
  const related = relatedCards(layout, node);
  return <>
    <h2>{node.title}</h2>
    <div className="graph-sub">{duplicateTitles.has(node.title) && <>{node.id} · </>}{node.category} · 被 {node.count} 张卡引用</div>
    {node.summary && <p className="graph-definition">{node.summary}</p>}
    <div className="graph-side-relations">
      {related.slice(0, 12).map(({ edge, other, direction }) =>
        <button key={edge.source + '/' + edge.target} onClick={() => onPickEdge(edge, node.id)}>
          <span>{direction}</span> {other.title}{duplicateTitles.has(other.title) && <small> {other.id}</small>}
        </button>)}
    </div>
    <div className="graph-side-actions">
      <button className="graph-detail-link" id={popup ? undefined : 'graph-open-card'} onClick={() => onRead(node)}>打开知识卡 →</button>
      <button className="graph-detail-link" onClick={() => onPick(node.id)}>查看关联（{related.length}）</button>
    </div>
  </>;
}

export function GraphPanel({ panelRef, node, layout, edge, index, setIndex, onPick, onPickEdge, onSource, onRead,
  onClose, duplicateTitles, onBack, canGoBack }) {
  const active = edge?.occurrences[index];
  const related = edge ? [] : relatedCards(layout, node);
  const header = useRef(null);
  const previousLayout = useRef(layout);
  useLayoutEffect(() => {
    const panel = panelRef.current;
    panel.show();
    return () => panel.close();
  }, [panelRef]);
  useLayoutEffect(() => {
    // A fresh graph may remove the inspected edge and leave this panel showing
    // its source node. Keep the reader's focus and scroll during reconciliation.
    const refreshed = layout !== previousLayout.current;
    previousLayout.current = layout;
    if (refreshed) return;
    panelRef.current.scrollTop = 0;
    header.current?.focus({ preventScroll: true });
  }, [layout, node.id, edge?.source, edge?.target, panelRef]);
  const title = item => <>{item.title}{duplicateTitles.has(item.title) && <small className="graph-card-id">{item.id}</small>}</>;
  return <dialog className={'graph-card' + (edge ? ' graph-evidence' : '')} ref={panelRef} aria-labelledby="graph-selected-title">
    <div className="graph-card-head">
      <h2 id="graph-selected-title" ref={header} tabIndex={-1}>{edge ? '引用依据' : title(node)}</h2>
      <button className="graph-close" title="关闭" aria-label="关闭浮卡" onClick={onClose}>×</button>
    </div>
    {edge ? <>
      <div className="graph-sub">正文引用</div>
      <div className="graph-endpoints">
        <button onClick={() => onPick(edge.source)}>{title(layout.byId.get(edge.source))}</button>
        <span> 引用 → </span>
        <button onClick={() => onPick(edge.target)}>{title(layout.byId.get(edge.target))}</button>
      </div>
      {active && <div className="graph-relation">
        <blockquote>{active.excerpt}</blockquote>
        {edge.occurrences.length > 1 && <div className="graph-citations">
          <button disabled={index === 0} aria-label="上一处引用" onClick={() => setIndex(index - 1)}>‹</button>
          <span aria-live="polite">{index + 1} / {edge.occurrences.length}</span>
          <button disabled={index === edge.occurrences.length - 1} aria-label="下一处引用" onClick={() => setIndex(index + 1)}>›</button>
        </div>}
        <div className="graph-relation-source">出处 · <button id="graph-open-source" onClick={() => onSource(edge, active)}>回到引用原文</button></div>
      </div>}
    </> : <>
      <div className="graph-sub">{node.category} · 被 {node.count} 张卡引用 · {related.length} 条关联</div>
      {node.summary && <p className="graph-definition">{node.summary}</p>}
      <h3 className="graph-relations-heading">关系<span>{related.length}</span></h3>
      {related.map(({ edge: item, other, direction }) =>
        <div className="graph-relation" key={item.source + '/' + item.target}>
          <div className="graph-relation-line">
            <button className="graph-direction" title="查看引用依据" aria-label={'查看引用依据：' + layout.byId.get(item.source).title + ' → ' + layout.byId.get(item.target).title}
              onClick={() => onPickEdge(item, node.id)}>{direction}</button>
            <button className="graph-related-name" onClick={() => onPick(other.id)}>{title(other)}</button>
          </div>
          <blockquote>{item.occurrences[0]?.excerpt}</blockquote>
          <div className="graph-relation-source">出处 · <button onClick={() => onSource(item, item.occurrences[0])}>
            《{layout.byId.get(item.source).title}》</button>
            {item.occurrences.length > 1 && <> · <button onClick={() => onPickEdge(item, node.id)}>查看 {item.occurrences.length} 处引用</button></>}
          </div>
        </div>)}
      {!related.length && <div className="graph-relation graph-sub">这张卡暂无已查到的卡间引用</div>}
    </>}
    <div className="graph-foot">
      <button id="graph-open-card" onClick={() => onRead(node)}>打开知识卡 →</button>
      {canGoBack && <button onClick={onBack}>上一步</button>}
    </div>
  </dialog>;
}
