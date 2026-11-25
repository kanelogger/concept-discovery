import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import Alert from "antd/es/alert";
import { DownOutlined } from "@ant-design/icons";
import "./card-reader.css";

export function CardBody({ current, prepared, anchor, onJump, recalling }) {
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
        if (isCitation) {
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
      <Alert className="reader-notice" type="info" role="status" title="原来的引用位置已变化。已打开来源卡，可在正文中查看当前内容。" />}
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
            <DownOutlined aria-hidden="true" />
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
