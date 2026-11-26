import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { formatDate } from "./workspace.mjs";
import { TagChip } from "./tag-chip.jsx";
import { prepareCardBody } from "./card-sections.mjs";
import { ReaderScenarioLinks } from "./scenario-links.jsx";
import { Button } from "./components/ui/button.jsx";
import { lazyRoute } from "./components/lazy-route.jsx";
export { default as stylesheet } from "./card-reader.css?route";

function CardBody({ current, prepared, anchor, onJump, recalling }) {
  const { html, understanding, situation, sections } = prepared;
  const body = useRef(null);
  const directory = useRef(null);
  const recallHeading = useRef(null);
  const jumpedTo = useRef(null);
  const [active, setActive] = useState(sections[0]?.id);
  const [unavailableCitation, setUnavailableCitation] = useState(null);
  const markup = useMemo(() => ({ __html: html }), [html]);
  const understandingMarkup = useMemo(() => ({ __html: understanding }), [understanding]);
  const situationMarkup = useMemo(() => ({ __html: situation }), [situation]);
  const hasOverview = Boolean(understanding || situation);
  const indexed = !recalling && sections.length > 0;

  useLayoutEffect(() => {
    if (recalling) recallHeading.current?.focus();
  }, [recalling]);

  useLayoutEffect(() => {
    if (!anchor) return;
    const frame = requestAnimationFrame(() => {
      const target = document.getElementById(anchor);
      const isCitation = anchor.startsWith("cd-ref-");
      if (!body.current?.closest("#reader")?.contains(target)) {
        if (isCitation || /^\d{14}-[a-z0-9]{7}$/.test(anchor)) {
          setUnavailableCitation({ current, anchor });
          body.current?.closest("#workspace")?.scrollTo(0, 0);
        }
        return;
      }
      const disclosure = target.closest("details");
      if (disclosure) disclosure.open = true;
      if (isCitation) target.focus({ preventScroll: true });
      target.scrollIntoView({ block: "start" });
      jumpedTo.current = body.current.closest("#workspace").scrollTop;
      if (sections.some(section => section.id === anchor)) setActive(anchor);
    });
    return () => cancelAnimationFrame(frame);
  }, [anchor, current, sections]);

  useLayoutEffect(() => {
    const rail = directory.current;
    if (!rail || rail.scrollHeight <= rail.clientHeight) return;
    const link = rail.querySelector('[aria-current="location"]');
    if (!link?.getClientRects().length) return;
    const { top } = rail.getBoundingClientRect();
    const item = link.getBoundingClientRect();
    const upper = item.top - top - 6;
    const lower = item.bottom - top - rail.clientHeight + 6;
    // Only scroll the directory. The reader's position stays put.
    if (upper < 0) rail.scrollTop += upper;
    else if (lower > 0) rail.scrollTop += lower;
  }, [active, indexed]);

  useEffect(() => {
    if (!indexed) return;
    const pane = body.current.closest("#workspace");
    const targets = sections.map(({ id }) => document.getElementById(id));
    let frame = 0;
    function syncSection() {
      if (frame || pane.scrollTop === jumpedTo.current) return;
      jumpedTo.current = null;
      frame = requestAnimationFrame(() => {
        frame = 0;
        const marker = pane.getBoundingClientRect().top + 72;
        const atEnd = pane.scrollTop > 0 && pane.scrollHeight - pane.clientHeight - pane.scrollTop <= 1;
        const current = atEnd ? targets.at(-1) : targets.findLast(target => target?.getBoundingClientRect().top <= marker);
        setActive(current?.id ?? sections[0].id);
      });
    }
    pane.addEventListener("scroll", syncSection, { passive: true });
    return () => {
      pane.removeEventListener("scroll", syncSection);
      cancelAnimationFrame(frame);
    };
  }, [indexed, sections]);

  function jump(event, id) {
    if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    const target = document.getElementById(id);
    event.preventDefault();
    onJump(id);
    target.focus({ preventScroll: true });
    target.scrollIntoView({ block: "start" });
    jumpedTo.current = body.current.closest("#workspace").scrollTop;
    setActive(id);
  }

  const understandingView = understanding && <div className="prose reader-understanding" dangerouslySetInnerHTML={understandingMarkup} />;
  const situationView = situation && <div className="prose reader-situation" dangerouslySetInnerHTML={situationMarkup} />;
  const chapters = html && <div className="prose reader-chapters" dangerouslySetInnerHTML={markup} />;
  return <>
    {unavailableCitation?.current === current && unavailableCitation.anchor === anchor &&
      <p className="reader-notice paper-notice" role="status">原来的引用位置已变化。已打开来源卡，可在正文中查看当前内容。</p>}
    <div ref={body} id="document-body"
      className={`reader-body-layout${indexed ? " has-contents" : ""}${hasOverview ? " has-overview" : ""}`}>
      {recalling ? <>
        {situationView}
        <section className="reader-recall" aria-labelledby="reader-recall-heading">
          <h2 ref={recallHeading} id="reader-recall-heading" tabIndex={-1}>先试着回想</h2>
          <p>{current.question}</p>
        </section>
        <details className="reader-reference">
          <summary>
            <span className="reference-open">展开理解与参考</span>
            <span className="reference-close">收起理解与参考</span>
            <span className="reader-chevron reader-chevron--down" aria-hidden="true" />
          </summary>
          {understandingView}
          {chapters}
        </details>
      </> : <>
        {hasOverview && <div className="reader-overview">{understandingView}{situationView}</div>}
        {indexed && <nav ref={directory} className="reader-contents" aria-labelledby="reader-contents-label">
          <div id="reader-contents-label">本文目录</div>
          <ul>{sections.map(({ id, label, overview }) => <li key={id} className={overview ? "reader-contents-overview" : undefined}>
            <a href={`#${encodeURIComponent(id)}`} aria-current={active === id ? "location" : undefined}
              onClick={event => jump(event, id)}>{label}</a>
          </li>)}</ul>
        </nav>}
        {chapters}
      </>}
    </div>
  </>;
}

function Reader({ current, prepared, anchor, recalling, scenarioSourceView, scenarioData, workspace }) {
  const readings = current.readings ?? [];
  const tags = current.tags ?? [];
  const aliases = useMemo(() => ({ __html: prepared.aliases }), [prepared.aliases]);
  return <article id="reader" className="reader" aria-labelledby="document-title">
    <header className="reader-heading">
      {prepared.metadata.name.map(id => <span key={id} id={id} className="reader-field-anchor" aria-hidden="true" />)}
      <h1 id="document-title">{current.title}</h1>
      {prepared.aliases && <div className="reader-aliases" dangerouslySetInnerHTML={aliases} />}
      {tags.length > 0 && <>
        {prepared.metadata.tags.map(id => <span key={id} id={id} className="reader-field-anchor" aria-hidden="true" />)}
        <div className="record-meta">{tags.map(tag => <TagChip key={tag} tag={tag} />)}</div>
      </>}
      {scenarioSourceView && <ReaderScenarioLinks cardId={current.id} fromView={scenarioSourceView}
        atlasData={scenarioData} readAtlas={workspace.readAtlasRelations} onCrossJump={workspace.jumpToAtlas} />}
    </header>
    <CardBody current={current} prepared={prepared} anchor={anchor} recalling={recalling} onJump={workspace.setCardFragment} />
    {(readings.length > 0 || current.updated) && <footer className="reader-footer">
      {readings.length > 0 && <section id="readings" className="readings" aria-labelledby="readings-heading">
        <h2 id="readings-heading">补充阅读</h2>
        <ul id="reading-list">{readings.map(item => <li key={item.id}>
          <a href={workspace.href("detail", item.id)} data-card-id={item.id}>
            {item.title}<span className="reader-chevron" aria-hidden="true" />
          </a>
        </li>)}</ul>
      </section>}
      {current.updated && <time className="reader-updated">更新于 {formatDate(current.updated)}</time>}
    </footer>}
  </article>;
}

const CardSharePanel = lazyRoute(() => import("./card-share.jsx"), "CardSharePanel");
const LifecycleDialog = lazyRoute(() => import("./card-lifecycle.jsx"), "LifecycleDialog");
const DatabaseCardButton = lazyRoute(() => import("./card-lifecycle.jsx"), "DatabaseCardButton", null);

export default function CardReader({ state, workspace, owner, ownerMaintenance, databaseFirst, children }) {
  const card = state.current;
  const prepared = useMemo(() => card && prepareCardBody(card), [card]);
  const [recallCard, setRecallCard] = useState(null);
  const [shareCard, setShareCard] = useState(null);
  const [archiveCard, setArchiveCard] = useState(null);
  const sharing = Boolean(card && shareCard === card);
  const recalling = Boolean(card?.question && recallCard === card);
  useLayoutEffect(() => {
    workspace.routeContentReady("detail");
  }, [workspace, card]);
  return <div className={prepared?.sections.length ? "record-page record-page--indexed" : "record-page"}>
    <div className="record-controls">
      <div className="record-back">
        <Button id="back-to-list" variant="text" onClick={() => void workspace.backFromCard()}>
          <span aria-hidden="true">←</span>
          {state.graphReturn ? "返回图谱" : state.scenarioReturn ? "返回图鉴" : "返回列表"}
        </Button>
      </div>
      <div className="document-toolbar">
        <span id="document-status" role="status" aria-live="polite">{state.navigating ? "正在读取…" : ""}</span>
        {card?.shareable && owner && <Button variant="text" aria-expanded={sharing} aria-controls={sharing ? "card-share-panel" : undefined}
          onClick={() => setShareCard(sharing ? null : card)}>分享</Button>}
        {ownerMaintenance && card?.canArchive && <>
          <Button variant="text" onClick={() => setArchiveCard(card)}>归档</Button>
          {databaseFirst && <DatabaseCardButton key={card.id} cardId={card.id} enabled />}
        </>}
        {card?.question && <Button id="try-recall" variant="text" onClick={() => setRecallCard(recalling ? null : card)}>
          {recalling ? "返回阅读" : "试着回想"}
        </Button>}
      </div>
    </div>
    {sharing && <CardSharePanel key={card.id} cardId={card.id} />}
    {archiveCard && archiveCard === card && <LifecycleDialog action="archive" target={archiveCard}
      onClose={() => setArchiveCard(null)} onConfirmed={operation => {
        location.assign("/archives?operation=" + encodeURIComponent(operation.id));
      }} />}
    {children}
    {card && <Reader key={card.id} current={card} prepared={prepared} anchor={state.documentAnchor}
      recalling={recalling} scenarioSourceView={state.scenarioSourceView} scenarioData={state.scenarioRelationsData} workspace={workspace} />}
  </div>;
}
