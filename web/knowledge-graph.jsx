// Graph sidebar and controls adapted from yibie/claude-best-practices-zh, mindmap/graph.html (MIT).
import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { buildGraphLayout, categoryColor } from './graph-layout.mjs';
import { GraphCanvas } from './graph-canvas.jsx';
import { GraphPanel, SidebarDetails } from './graph-panel.jsx';

const empty = Object.freeze({});
const sameEdge = (a, b) => a && b && a.source === b.source && a.target === b.target;

function GraphSearch({ nodes, query, setQuery, onChoose, duplicateTitles }) {
  const [open, setOpen] = useState(false);
  const [index, setIndex] = useState(0);
  const resultsId = useId();
  const term = query.trim().toLocaleLowerCase();
  const results = useMemo(() => term ? nodes.filter(node =>
    node.title.toLocaleLowerCase().includes(term) || node.id.toLowerCase().includes(term)) : [], [nodes, term]);
  const active = Math.min(index, results.length - 1);
  const optionId = i => resultsId + '-' + i;
  const expanded = Boolean(term && open);
  function choose(node) {
    setOpen(false);
    onChoose(node);
  }
  function onKey(event) {
    if (event.nativeEvent.isComposing || event.keyCode === 229) return;
    if (event.key === 'Escape' && expanded) {
      event.stopPropagation();
      event.preventDefault();
      setOpen(false);
      return;
    }
    if (event.key === 'Enter' && results.length) {
      event.preventDefault();
      choose(results[Math.max(0, active)]);
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const next = open ? Math.max(0, Math.min(results.length - 1, active + (event.key === 'ArrowDown' ? 1 : -1))) : 0;
      setOpen(true);
      setIndex(next);
      requestAnimationFrame(() => document.getElementById(optionId(next))?.scrollIntoView({ block: 'nearest' }));
    }
  }
  return <div className="graph-search" onBlur={event => {
    if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
  }}>
    <input id="graph-search" type="search" autoComplete="off" role="combobox" aria-label="搜索卡片"
      placeholder="搜索卡片，回车定位" aria-autocomplete="list" aria-expanded={expanded}
      aria-controls={resultsId} aria-activedescendant={expanded && active >= 0 ? optionId(active) : undefined}
      value={query} onChange={event => { setIndex(0); setOpen(true); setQuery(event.target.value); }}
      onFocus={() => setOpen(true)} onClick={() => setOpen(true)} onKeyDown={onKey} />
    <div className="graph-search-popup" hidden={!expanded}>
      <ul id={resultsId} role="listbox" aria-label="卡片搜索结果">
        {expanded && results.map((node, i) => <li id={optionId(i)} key={node.id} role="option"
          aria-selected={active === i} onPointerDown={event => event.preventDefault()} onClick={() => choose(node)}>
          {node.title}{duplicateTitles.has(node.title) && <small>{node.id}</small>}
        </li>)}
      </ul>
      {expanded && !results.length && <p role="status">没有匹配的卡片</p>}
    </div>
  </div>;
}

export default function KnowledgeGraph({ data, positions, view = empty, onViewChange, onOpenSource, onOpenCard, onOpenList,
  onRetry, loading, error, onBack, canGoBack, onContentReady }) {
  useLayoutEffect(() => { onContentReady('graph'); }, [onContentReady, data, loading, error]);
  const layout = useMemo(() => buildGraphLayout(data), [data]);
  const duplicateTitles = useMemo(() => {
    const names = new Set(), repeated = new Set();
    for (const node of layout.nodes) {
      if (names.has(node.title)) repeated.add(node.title);
      names.add(node.title);
    }
    return repeated;
  }, [layout]);
  const canvas = useRef(null);
  const stage = useRef(null);
  const panel = useRef(null);
  const anchor = useRef(null);
  const pendingSearch = useRef(null);
  const latest = useRef(view);
  latest.current = view;
  const [hovered, setHovered] = useState(null);
  const selected = layout.byId.get(view.nodeId);
  const inspected = layout.byId.get(hovered) || selected;
  const edge = view.edge && selected && layout.adjacent.get(selected.id)?.find(item => sameEdge(item, view.edge));
  const popup = Boolean(selected && (edge || view.popup !== false));
  const idx = Math.min(Math.max(0, Number(view.occurrenceIndex) || 0), Math.max(0, (edge?.occurrences.length || 0) - 1));
  const hidden = view.hiddenCategories || [];
  const core = Boolean(view.coreOnly);
  const labels = view.showLabels !== false;
  const partial = data?.complete === false;
  const hasGraph = layout.nodes.length > 0;
  const message = error ? (typeof error === 'string' ? error : error.message || '图谱读取失败') : '';

  const patchView = useCallback((patch, replace = false) => {
    const previous = latest.current;
    // A selection made while the search camera is following a moving node starts
    // its own entry at the current world position. Back still follows the search.
    const camera = previous.camera?.focusId && 'nodeId' in patch ? canvas.current?.getCamera() : null;
    const next = { ...previous, ...(camera && { camera }), ...patch };
    latest.current = next;
    onViewChange(next, { replace });
  }, [onViewChange]);

  function chooseNode(id, search = false) {
    const node = layout.byId.get(id);
    if (!node) return;
    setHovered(null);
    pendingSearch.current = search ? id : null;
    patchView({ nodeId: id, edge: null, occurrenceIndex: 0, popup: !search,
      hiddenCategories: hidden.filter(item => item !== node.category),
      coreOnly: core && node.count >= layout.coreThreshold,
      ...(search && { query: node.title }) }, id === selected?.id && !edge && popup === !search);
  }
  useLayoutEffect(() => {
    const id = pendingSearch.current;
    pendingSearch.current = null;
    if (!id || id !== view.nodeId || view.popup !== false) return;
    // The canvas has applied this history entry and settled any changed category filter.
    canvas.current?.focusNode(id);
  }, [view]);

  function chooseEdge(item, fromId = selected?.id) {
    const id = [item.source, item.target].includes(fromId) ? fromId : item.source;
    const endpoints = [layout.byId.get(item.source), layout.byId.get(item.target)];
    setHovered(null);
    patchView({ nodeId: id, edge: { source: item.source, target: item.target }, occurrenceIndex: 0, popup: true,
      hiddenCategories: hidden.filter(category => !endpoints.some(n => n.category === category)),
      coreOnly: core && endpoints.every(n => n.count >= layout.coreThreshold) },
      Boolean(sameEdge(item, edge)));
  }

  function openSource(item, occurrence) {
    if (!occurrence) return;
    if (!sameEdge(item, edge)) chooseEdge(item);
    onOpenSource(item, occurrence);
  }

  function readSidebarCard(node) {
    setHovered(null);
    patchView({ nodeId: node.id, popup: false, edge: null, occurrenceIndex: 0 }, true);
    onOpenCard(node);
  }

  function changeFilters(categories, coreOnly) {
    const visible = node => node && !categories.includes(node.category) && (!coreOnly || node.count >= layout.coreThreshold);
    const clear = !visible(selected) || (edge && (!visible(layout.byId.get(edge.source)) || !visible(layout.byId.get(edge.target))));
    setHovered(null);
    patchView({ hiddenCategories: categories, coreOnly, ...(clear && { nodeId: null, edge: null, occurrenceIndex: 0, popup: false }) }, true);
  }

  function dismiss(restoreFocus = false) {
    canvas.current?.dismissFocus(restoreFocus ? selected?.id : null, restoreFocus ? edge : null);
    setHovered(null);
    if (selected) patchView({ nodeId: null, edge: null, occurrenceIndex: 0, popup: false });
  }

  const placePanel = useCallback(point => {
    if (point) anchor.current = point;
    const card = panel.current, box = stage.current, p = anchor.current;
    if (!card || !box || !p) return;
    const height = box.clientHeight, cw = card.offsetWidth, ch = card.offsetHeight;
    const right = box.offsetLeft + box.clientWidth;
    const minLeft = cw + 28 <= box.clientWidth ? box.offsetLeft + 14 : 14;
    let left = box.offsetLeft + p.x + 26;
    if (left + cw > right - 14) left = box.offsetLeft + p.x - cw - 26;
    card.style.left = Math.max(minLeft, Math.min(left, right - cw - 14)) + 'px';
    card.style.top = Math.max(14, Math.min(p.y - ch / 3, height - ch - 14)) + 'px';
  }, []);
  useLayoutEffect(() => {
    if (!popup || !panel.current) return;
    placePanel();
    const observer = new ResizeObserver(() => placePanel());
    observer.observe(panel.current);
    observer.observe(stage.current);
    return () => observer.disconnect();
  }, [popup, placePanel]);
  useEffect(() => {
    if (!selected) return;
    const onKey = event => {
      if (event.key !== 'Escape' || event.defaultPrevented || event.isComposing) return;
      dismiss(true);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [selected, edge, patchView]);
  const allHidden = hasGraph && !layout.nodes.some(node => !hidden.includes(node.category) && (!core || node.count >= layout.coreThreshold));

  return <section className="knowledge-graph" aria-label="知识图谱">
    <aside className="graph-sidebar" aria-label="图谱工具">
      <header className="graph-brand">
        <h1 id="graph-heading" tabIndex={-1}>知识图谱</h1>
        {data && <p>{layout.nodes.length} 张知识卡 · 正文引用</p>}
      </header>
      {hasGraph && <>
        <GraphSearch nodes={layout.nodes} query={view.query || ''} setQuery={query => patchView({ query }, true)}
          duplicateTitles={duplicateTitles} onChoose={node => chooseNode(node.id, true)} />
        <div className="graph-filters" role="group" aria-label="分类筛选">
          {layout.categories.map(category => <button className="graph-chip" aria-pressed={!hidden.includes(category)} key={category}
            onClick={() => changeFilters(hidden.includes(category) ? hidden.filter(item => item !== category) : [...hidden, category], core)}>
            <svg width="7" height="7" aria-hidden="true"><circle cx="3.5" cy="3.5" r="3.5" fill={categoryColor(category, layout.categories)} /></svg>
            {category}</button>)}
        </div>
        <div className="graph-controls" role="group" aria-label="图谱视图">
          <button aria-pressed={labels} onClick={() => patchView({ showLabels: !labels }, true)}>关系标签</button>
          <button aria-pressed={core} title={'显示被至少 ' + layout.coreThreshold + ' 张卡引用的卡片'}
            onClick={() => changeFilters(hidden, !core)}>只看核心</button>
          <button onClick={() => canvas.current?.reset()}>重置视图</button>
        </div>
      </>}
      <div className="graph-side-detail">
        {data && (partial || loading || message) && <div className="graph-notice" role="status">
          {loading ? '正在读取知识图谱…' : message || <>部分知识卡未能读取。{Number.isInteger(data.scanned) &&
            `已读取正文 ${data.scanned} / ${data.total ?? layout.nodes.length} 张。`}</>}
          {!loading && <button onClick={onRetry}>重试</button>}
        </div>}
        {inspected ? <SidebarDetails node={inspected} layout={layout} duplicateTitles={duplicateTitles}
          onPickEdge={chooseEdge} onPick={chooseNode} onRead={readSidebarCard} popup={popup} /> : hasGraph && <>
          <p className="graph-hint">点节点看卡片与关联，点连线看引用原文。双击打开知识卡，滚轮缩放、拖拽平移。</p>
          <div className="graph-stats">
            {[[layout.nodes.length, '知识卡'], [layout.edges.length, partial ? '已知引用' : '引用'], [layout.categories.length, '分类']].map(([n, text]) =>
              <div key={text}><b>{n}</b><span>{text}</span></div>)}
          </div>
        </>}
        {canGoBack && !popup && <button className="graph-detail-link" onClick={onBack}>上一步</button>}
      </div>
    </aside>
    <div className="graph-stage" ref={stage}>
      {hasGraph ? <>
        <GraphCanvas ref={canvas} positions={positions} layout={layout} view={view}
          onHover={id => setHovered(old => id ?? (latest.current.nodeId ? null : old))}
          onPick={id => chooseNode(id)} onDoubleClick={id => window.open('/cards/' + encodeURIComponent(id), '_blank', 'noopener')}
          onEdge={item => chooseEdge(item)} onCamera={camera => patchView({ camera }, true)}
          onDismiss={() => dismiss()} onPoint={placePanel} />
        {allHidden && <div className="graph-empty-filter" role="status">
          <p>{core ? '当前分类中没有符合核心条件的卡片' : '所有分类均已隐藏'}</p>
          <button onClick={() => changeFilters([], false)}>显示全部卡片</button>
        </div>}
        <div className="graph-legend"><b>节点大小</b> = 引用这张卡的卡片数 ｜ <b>连线</b> = 正文引用<br />
          悬停高亮关联 · 箭头指向被引用的卡 · 双击打开知识卡</div>
      </> : <div className="graph-empty" role="status">
        {data ? <>
          <h2>{partial ? '尚未读取到知识卡' : '还没有知识卡'}</h2><button onClick={onOpenList}>查看知识卡</button>
        </> : message ? <>
          <h2>图谱读取失败</h2><p>{message}</p><button onClick={onRetry}>重试</button>
        </> : <p>正在读取知识图谱…</p>}
      </div>}
    </div>
    {popup && <GraphPanel panelRef={panel} node={selected} layout={layout} edge={edge} index={idx}
      setIndex={occurrenceIndex => patchView({ occurrenceIndex }, true)} onPick={chooseNode} onPickEdge={chooseEdge}
      onSource={openSource} onRead={onOpenCard} onClose={() => dismiss(true)} duplicateTitles={duplicateTitles}
      onBack={onBack} canGoBack={canGoBack} />}
  </section>;
}
