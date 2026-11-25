import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { routeHref } from "./routes.mjs";
import { scrollWorkspaceTo } from "./lib/utils.mjs";
import { indexAtlasRelations, ScenarioLinks } from "./scenario-links.jsx";
import "./scenario-atlas.css";

const views = { scenes: "按问题场景", disciplines: "按学科" };
const emptyCategories = [];
const easing = "cubic-bezier(.16, 1, .3, 1)";
const modified = event => event.altKey || event.ctrlKey || event.metaKey || event.shiftKey;

function CardContent({ item, titleHref, titleId }) {
  return <>
    {item.note && <p className="atlas-card-note">{item.note}</p>}
    <h3>{titleHref ? <a className="atlas-card-title-link" id={titleId} href={titleHref}>{item.card.title}</a> : item.card.title}</h3>
    {item.card.excerpt && <p className="atlas-card-excerpt">{item.card.excerpt}</p>}
  </>;
}

function CardDeck({ items, currentId, entryId, description, onTurn, cardHref, view, relations, onCrossJump, contextLabel }) {
  const card = useRef(null);
  const gesture = useRef(null);
  const animation = useRef(null);
  const [preview, setPreview] = useState(null);
  const index = Math.max(0, items.findIndex(item => item.card.id === currentId));
  const active = items[index];
  const canTurn = direction => Boolean(items[index + direction]);
  const hasGestures = items.length > 1;
  const motionReduced = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

  useEffect(() => () => animation.current?.cancel(), []);

  function offset(distance) {
    card.current.style.setProperty("--atlas-drag", `${distance}px`);
    card.current.style.setProperty("--atlas-tilt", `${Math.max(-13, Math.min(13, distance / 13))}deg`);
  }

  function chooseCard(id, pointerSelection) {
    animation.current?.cancel();
    animation.current = null;
    const node = card.current;
    if (gesture.current) {
      const { id: pointerId } = gesture.current;
      gesture.current = null;
      delete node.dataset.dragging;
      if (node.hasPointerCapture(pointerId)) node.releasePointerCapture(pointerId);
    }
    offset(0);
    setPreview(null);
    if (active.card.id !== id) onTurn(id);
    if (pointerSelection) requestAnimationFrame(() => {
      if (!node.isConnected) return;
      const pane = node.closest("#workspace");
      if (pane && node.getBoundingClientRect().top + 88 > pane.getBoundingClientRect().bottom) scrollWorkspaceTo(pane, node);
    });
  }

  async function turn(direction) {
    if (animation.current || !canTurn(direction)) return;
    const next = items[index + direction];
    if (motionReduced()) {
      offset(0);
      setPreview(null);
      onTurn(next.card.id);
      return;
    }
    const node = card.current;
    const distance = Math.max(350, node.clientWidth * 1.14);
    setPreview(next);
    const release = node.animate([
      { transform: getComputedStyle(node).transform },
      { transform: `translateX(${-direction * distance}px) rotate(${-direction * 13}deg)` },
    ], { duration: 190, easing: "cubic-bezier(.32,.62,.78,1)", fill: "forwards" });
    animation.current = release;
    try {
      await release.finished;
      onTurn(next.card.id);
      offset(0);
      setPreview(null);
      release.cancel();
      const advance = node.animate([
        { transform: "translateY(5px) scale(.976)" }, { transform: "none" },
      ], { duration: 210, easing });
      animation.current = advance;
      await advance.finished;
    } catch (error) {
      if (error.name !== "AbortError") throw error;
    } finally {
      animation.current = null;
    }
  }

  async function settle() {
    const node = card.current;
    const from = getComputedStyle(node).transform;
    offset(0);
    if (!motionReduced() && from !== getComputedStyle(node).transform) {
      const reset = node.animate([{ transform: from }, { transform: "none" }], { duration: 220, easing });
      animation.current = reset;
      try {
        await reset.finished;
      } catch (error) {
        if (error.name !== "AbortError") throw error;
      } finally {
        animation.current = null;
      }
    }
    if (node.isConnected) setPreview(null);
  }

  function start(event) {
    if (!hasGestures || !event.isPrimary || event.button !== 0 || modified(event) ||
        animation.current || gesture.current || event.target.closest("a")) return;
    gesture.current = {
      id: event.pointerId, x: event.clientX, y: event.clientY, distance: 0, horizontal: false,
    };
  }

  function move(event) {
    const grab = gesture.current;
    if (grab?.id !== event.pointerId) return;
    const dx = event.clientX - grab.x;
    const dy = event.clientY - grab.y;
    if (!grab.horizontal) {
      if (Math.abs(dy) >= 9 && Math.abs(dy) > Math.abs(dx)) {
        finish(event, false);
        return;
      }
      if (Math.abs(dx) < 9) return;
      grab.horizontal = true;
      event.currentTarget.setPointerCapture(event.pointerId);
      event.currentTarget.dataset.dragging = "";
    }
    grab.distance = dx;
    if (!motionReduced()) {
      const direction = dx < 0 ? 1 : -1;
      setPreview(items[index + direction] ?? null);
      offset(dx * (canTurn(direction) ? 1 : .28));
    }
  }

  function finish(event, commit) {
    const grab = gesture.current;
    if (grab?.id !== event.pointerId) return;
    const node = event.currentTarget;
    gesture.current = null;
    delete node.dataset.dragging;
    if (node.hasPointerCapture(event.pointerId)) node.releasePointerCapture(event.pointerId);
    const threshold = Math.max(44, Math.min(90, node.clientWidth * .19));
    let direction = 0;
    if (commit && Math.abs(grab.distance) >= threshold) {
      direction = grab.distance < 0 ? 1 : -1;
    } else if (commit && !grab.horizontal && Math.hypot(event.clientX - grab.x, event.clientY - grab.y) < 9) {
      const bounds = node.getBoundingClientRect();
      const hit = (event.clientX - bounds.left) / bounds.width;
      if (hit >= 0 && hit <= .24) direction = -1;
      if (hit >= .76 && hit <= 1) direction = 1;
    }
    if (direction && canTurn(direction)) void turn(direction);
    else if (grab.horizontal) void settle();
  }

  function arrowTurn(event) {
    if (!hasGestures || event.target !== event.currentTarget || modified(event) || gesture.current) return;
    const direction = { ArrowLeft: -1, ArrowRight: 1 }[event.key];
    if (!direction) return;
    event.preventDefault();
    void turn(direction);
  }

  return <div className={description || hasGestures ? "atlas-deck" : "atlas-deck atlas-deck--solo"}>
    {(description || hasGestures) && <div className="atlas-deck-intro">
      {description && <p>{description}</p>}
      {hasGestures && <>
        <p className="atlas-gesture-hint">点卡名直达，或左右滑动翻卡。</p>
        <ul className="atlas-card-picker" aria-label="卡片目录">
          {items.map(({ card: option }) => <li key={option.id}>
            <button type="button" aria-current={option.id === active.card.id ? "true" : undefined}
              onClick={event => chooseCard(option.id, event.detail > 0)}>{option.title}</button>
          </li>)}
        </ul>
      </>}
    </div>}
    <div className="atlas-deck-main">
      <div className="atlas-stage">
        {hasGestures && <>
          <div className="atlas-card-back" aria-hidden="true" />
          <div className="atlas-card-back" aria-hidden="true" />
        </>}
        {preview && <article className="atlas-card atlas-card-preview" aria-hidden="true">
          <CardContent item={preview} />
        </article>}
        <article className="atlas-card" id={`atlas-preview-${entryId}`} ref={card}
          data-gestures={hasGestures || undefined}
          tabIndex={hasGestures ? 0 : -1}
          aria-describedby={hasGestures ? "atlas-card-help" : undefined}
          aria-keyshortcuts={hasGestures ? "ArrowLeft ArrowRight" : undefined}
          onPointerDown={start} onPointerMove={move}
          onPointerUp={event => finish(event, true)}
          onPointerCancel={event => finish(event, false)}
          onLostPointerCapture={event => finish(event, false)}
          onPointerLeave={event => { if (!gesture.current?.horizontal) finish(event, false); }}
          onKeyDown={arrowTurn}>
          {contextLabel && <p className="atlas-cross-context">{contextLabel}</p>}
          <CardContent item={active} titleHref={hasGestures ? undefined : cardHref(active.card.id)}
            titleId={hasGestures ? undefined : `atlas-card-${entryId}`} />
          <ScenarioLinks cardId={active.card.id} fromView={view} relations={relations.get(active.card.id)}
            focusPrefix={`atlas-preview-relation-${entryId}-${active.card.id}`} onCrossJump={onCrossJump} />
          {hasGestures && <a className="atlas-card-link" id={`atlas-card-${entryId}`} href={cardHref(active.card.id)} draggable={false}>
            打开知识卡
          </a>}
        </article>
      </div>
      {hasGestures && <p className="visually-hidden" role="status">
        第 {index + 1} 张，共 {items.length} 张。当前卡片：{active.card.title}
      </p>}
    </div>
  </div>;
}

function AtlasEntry({ entry, open, onToggle, cardMap, currentId, onTurn, cardHref, view, relations, onCrossJump, isJumpTarget }) {
  const items = entry.items.flatMap(item => {
    const card = cardMap.get(item.cardId);
    return card ? [{ ...item, card }] : [];
  });
  const panelId = `atlas-deck-${entry.id}`;
  return <div className="atlas-entry" id={view === "disciplines" ? entry.id : undefined}>
    <button type="button" id={`atlas-entry-${entry.id}`} className="atlas-entry-toggle"
      aria-expanded={open} aria-controls={panelId} onClick={onToggle}>
      <span>
        <span className="atlas-entry-title">{entry.title}</span>
        {entry.featured && <span className="atlas-featured">精选</span>}
      </span>
      <span className="atlas-stack-label">
        <i className="atlas-stack-icon" aria-hidden="true" />
        {items.length} 张知识卡
        <i className="atlas-chevron" aria-hidden="true" />
      </span>
    </button>
    <div id={panelId} hidden={!open}>
      {open && (items.length ? <CardDeck items={items} currentId={currentId}
        entryId={entry.id} description={entry.description} onTurn={onTurn} cardHref={cardHref}
        view={view} relations={relations} onCrossJump={onCrossJump} contextLabel={isJumpTarget ? entry.title : undefined} />
        : <div className="atlas-empty atlas-entry-empty">
          {entry.description && <p>{entry.description}</p>}
          <p>{view === "disciplines" ? "这个学科暂无已标注的知识卡。" : "这个问题还没有可浏览的知识卡。"}</p>
        </div>)}
    </div>
  </div>;
}

export function ScenarioAtlas({ data, loading, error, position, onPosition, onRetry, cardHref, onCrossJump, onBack }) {
  const view = position.view === "disciplines" ? "disciplines" : "scenes";
  const catalog = data?.catalog;
  const groups = catalog?.status === "ready" ? catalog.groups : emptyCategories;
  const disciplines = data?.disciplines ?? emptyCategories;
  const cardMap = useMemo(() => new Map((data?.cards ?? []).map(card => [card.id, card])), [data]);
  const relations = useMemo(() => indexAtlasRelations(data), [data]);
  const categories = view === "disciplines" ? disciplines : groups;
  const returnButton = Number.isInteger(position.returnIndex) && onBack &&
    <button type="button" className="atlas-return" onClick={() => void onBack()}>返回原处</button>;
  const open = position.open?.[view] !== undefined ? position.open[view]
    : view === "disciplines" ? disciplines.find(item => item.id === position.categoryId)?.id : undefined;
  const rail = useRef(null);
  const entries = useRef(null);
  const clicked = useRef(null);
  const [visible, setVisible] = useState(null);
  const activeId = visible?.view === view && categories.some(category => category.id === visible.id)
    ? visible.id : position.categoryId || categories[0]?.id;

  useEffect(() => {
    const body = entries.current;
    const pane = body?.closest("#workspace");
    if (!pane) return;
    const targets = categories.map(category => document.getElementById(category.id))
      .filter(target => target && body.contains(target));
    if (!targets.length) return;
    let frame = 0;
    function syncCategory() {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        const top = pane.scrollTop;
        // At the bottom several headings can be out of reach of the reading
        // line. Keep an explicit jump selected until the pane moves again.
        if (clicked.current?.view === view &&
            (clicked.current.top === null || clicked.current.top === top)) return;
        clicked.current = null;
        const margin = parseFloat(getComputedStyle(targets[0]).scrollMarginBlockStart) || 0;
        const line = pane.getBoundingClientRect().top + margin + 2;
        const atEnd = top > 0 && pane.scrollHeight - pane.clientHeight - top <= 1;
        const target = atEnd ? targets.at(-1) : targets.findLast(node => node.getBoundingClientRect().top <= line) ?? targets[0];
        setVisible(previous => previous?.view === view && previous.id === target.id ? previous : { view, id: target.id });
      });
    }
    pane.addEventListener("scroll", syncCategory, { passive: true });
    const observer = new ResizeObserver(syncCategory);
    observer.observe(pane);
    observer.observe(body);
    syncCategory();
    return () => {
      pane.removeEventListener("scroll", syncCategory);
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [categories, view, loading, error]);

  useLayoutEffect(() => {
    const nav = rail.current;
    const link = nav?.querySelector('[aria-current="location"]');
    if (!link) return;
    const bounds = nav.getBoundingClientRect();
    const item = link.getBoundingClientRect();
    const clip = (start, end, size) => start < 0 ? start : Math.max(0, end - size);
    // Keep the selected label in view without moving the reading pane.
    nav.scrollBy(clip(item.left - bounds.left, item.right - bounds.left, nav.clientWidth),
      clip(item.top - bounds.top, item.bottom - bounds.top, nav.clientHeight));
  }, [activeId, view, loading, error]);

  function switchView(next) {
    if (view !== next) onPosition({ view: next, categoryId: "" });
  }

  function tabsKeyDown(event) {
    if (modified(event)) return;
    const next = {
      ArrowLeft: view === "scenes" ? "disciplines" : "scenes",
      ArrowRight: view === "scenes" ? "disciplines" : "scenes",
      Home: "scenes", End: "disciplines",
    }[event.key];
    if (!next) return;
    event.preventDefault();
    switchView(next);
    document.getElementById(`atlas-tab-${next}`)?.focus();
  }

  function jump(event, id) {
    if (event.button || modified(event)) return;
    event.preventDefault();
    const pending = { view, id, top: null };
    clicked.current = pending;
    setVisible({ view, id });
    onPosition({
      categoryId: id,
      ...(view === "disciplines" && { open: { ...position.open, disciplines: id } }),
    });
    const category = document.getElementById(id);
    const focus = view === "disciplines" ? document.getElementById(`atlas-entry-${id}`) : category;
    focus?.focus({ preventScroll: true });
    requestAnimationFrame(() => {
      if (clicked.current !== pending || !category?.isConnected) return;
      const pane = category.closest("#workspace");
      scrollWorkspaceTo(pane, category);
      pending.top = pane?.scrollTop ?? 0;
    });
  }

  function renderEntry(entry) {
    return <AtlasEntry key={entry.id} entry={entry} cardMap={cardMap} cardHref={cardHref}
      view={view} relations={relations} onCrossJump={onCrossJump} open={open === entry.id}
      isJumpTarget={position.jumpEntry === entry.id}
      currentId={position.cards?.[entry.id]}
      onToggle={() => onPosition({ open: { ...position.open, [view]: open === entry.id ? null : entry.id } })}
      onTurn={cardId => onPosition({ cards: { ...position.cards, [entry.id]: cardId } })} />;
  }

  return <section className="atlas-page" aria-labelledby="atlas-heading">
    {(!categories.length || loading || error) && returnButton}
    <header className="atlas-intro">
      <h1 id="atlas-heading" tabIndex={-1}>场景图鉴</h1>
      <p>从手头的问题或感兴趣的学科，找到用得上的知识卡。</p>
    </header>

    <div className="atlas-tabs" role="tablist" aria-label="知识卡分类维度" onKeyDown={tabsKeyDown}>
      {Object.entries(views).map(([key, label]) => <button type="button" role="tab" key={key}
        id={`atlas-tab-${key}`} aria-selected={view === key} aria-controls={`atlas-panel-${key}`}
        tabIndex={view === key ? 0 : -1} onClick={() => switchView(key)}>
        {label}
      </button>)}
    </div>

    {Object.keys(views).map(key => <div role="tabpanel" key={key} id={`atlas-panel-${key}`}
      hidden={view !== key} aria-labelledby={`atlas-tab-${key}`}
      aria-busy={loading || undefined}>
      {view === key && <>
        {loading && <p className="atlas-status" role="status">正在读取场景图鉴…</p>}
        {error && <div className="atlas-status" role="alert">
          <p>暂时无法读取场景图鉴。</p>
          <button className="atlas-action" type="button" onClick={onRetry}>重新读取</button>
        </div>}
        {!loading && !error && data && <>
          {view === "scenes" && catalog.status === "missing" && <div className="atlas-empty">
            <p>还没有图鉴目录，可以切换到「按学科」浏览知识卡。</p>
          </div>}
          {view === "scenes" && catalog.status === "duplicate" && <div className="atlas-empty" role="status">
            <p>发现多张名为「场景图鉴」的知识卡。可以查看目录卡，或切换到「按学科」浏览。</p>
            <ul>{catalog.ids.map((id, i) => <li key={id}><a href={cardHref(id)}>查看目录卡 {i + 1}</a></li>)}</ul>
          </div>}
          {view === "scenes" && catalog.diagnostics.length > 0 && <details className="atlas-diagnostics">
            <summary>目录中有 {catalog.diagnostics.length} 处需要检查</summary>
            <ul>{catalog.diagnostics.map((diagnostic, i) => <li key={i}>{diagnostic}</li>)}</ul>
          </details>}
          {view === "scenes" && catalog.status === "ready" && groups.length === 0 &&
            <p className="atlas-empty">图鉴目录还没有场景。</p>}
          {view === "disciplines" && disciplines.length === 0 &&
            <p className="atlas-empty">还没有标注学科的知识卡。</p>}
          {categories.length > 0 && <div className="atlas-layout">
            <nav ref={rail} className="atlas-category-nav" aria-label={view === "scenes" ? "问题场景类目" : "学科类目"}>
              {returnButton}
              {categories.map(category => <a key={category.id}
                href={routeHref("scenarios", { view, categoryId: category.id })}
                aria-current={activeId === category.id ? "location" : undefined}
                onClick={event => jump(event, category.id)}>
                {category.title}
              </a>)}
            </nav>
            <div ref={entries} className="atlas-entries">
              {view === "scenes" ? groups.map(group => <section className="atlas-group"
                key={group.id} id={group.id} tabIndex={-1}>
                <h2>{group.title}</h2>
                {group.entries.map(renderEntry)}
              </section>) : <section className="atlas-group">
                <h2>学科目录</h2>
                {disciplines.map(renderEntry)}
              </section>}
            </div>
          </div>}
        </>}
      </>}
    </div>)}
    <p className="visually-hidden" id="atlas-card-help">使用左方向键查看上一张，右方向键查看下一张。</p>
  </section>;
}
