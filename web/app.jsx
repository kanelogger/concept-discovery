import React, { useEffect, useLayoutEffect, useMemo, useState, useSyncExternalStore } from "react";
import { createRoot } from "react-dom/client";
import Alert from "antd/es/alert";
import Button from "antd/es/button";
import ConfigProvider from "antd/es/config-provider";
import Flex from "antd/es/flex";
import Layout from "antd/es/layout";
import Result from "antd/es/result";
import Typography from "antd/es/typography";
import zhCN from "antd/locale/zh_CN";
import { ArrowLeftOutlined, RightOutlined } from "@ant-design/icons";
import { createWorkspace, formatDate } from "./workspace.mjs";
import { readRoute } from "./routes.mjs";
import { TagChip } from "./tag-chip.jsx";
import { paperTheme } from "./themes/antd.mjs";
import "./wiki.css";
import { CardBody } from "./card-reader.jsx";
import { prepareCardBody } from "./card-sections.mjs";
import { ScenarioAtlas } from "./scenario-atlas.jsx";
import { ReaderScenarioLinks } from "./scenario-links.jsx";
import "./knowledge-graph.css";
import { LoginPage, SessionGate } from "./session.jsx";
import { CardSharePanel, SharedCardPage, isSharedCardPath } from "./card-share.jsx";
import { ArchiveList, DatabaseCardButton, LifecycleDialog, useLifecycleSync } from "./card-lifecycle.jsx";
import { ManualDeletionNotice } from "./manual-deletion-notice.jsx";

const lifecycleEnabled = document.querySelector('meta[name="card-lifecycle"]')?.content === "enabled";

function ReloadRoute() {
  return <Alert type="error" title="页面组件未能加载"
    action={<Button onClick={() => window.location.reload()}>刷新当前页</Button>} />;
}

// Retain a loaded component for this tab. Its data request starts in the workspace
// independently of the import, and a late import cannot mount a route we have left.
function routeComponent(load) {
  let component, pending;
  return function Route(props) {
    const [Page, setPage] = useState(() => component);
    useEffect(() => {
      if (Page) return;
      let active = true;
      pending ??= load().then(module => module.default, () => ReloadRoute)
        .then(result => { component = result; return result; });
      pending.then(result => { if (active) setPage(() => result); });
      return () => { active = false; };
    }, [Page]);
    return Page ? <Page {...props} /> : <p role="status">正在打开页面…</p>;
  };
}
const CardList = routeComponent(() => import("./card-list.jsx"));
const KnowledgeGraph = routeComponent(() => import("./knowledge-graph.jsx"));
const WikiPage = routeComponent(() => import("./wiki.jsx"));

const { Text, Link } = Typography;

function Brand({ onClick }) {
  return <Link className="brand" href="/" id={onClick ? "home-link" : undefined} onClick={onClick}>
    <img className="brand-mark" src="/favicon.svg" width="32" height="32" alt="" />
    <span>Concept Discovery</span>
  </Link>;
}

function DocumentMessage({ message, workspace }) {
  if (!message) return null;
  return <Alert id="document-message" className="document-message" type={message.error ? "error" : "info"}
    title={<span id="document-message-text">{message.text}</span>}
    action={message.reload && <Button id="reload-document" size="small" onClick={() => void workspace.reload()}>重新读取</Button>} />;
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
            {item.title}<RightOutlined aria-hidden="true" />
          </a>
        </li>)}</ul>
      </section>}
      {current.updated && <time className="reader-updated">更新于 {formatDate(current.updated)}</time>}
    </footer>}
  </article>;
}

function Workspace({ workspace, onLogout }) {
  const sync = useLifecycleSync(lifecycleEnabled && Boolean(onLogout));
  const state = useSyncExternalStore(workspace.subscribe, workspace.getSnapshot);
  const isDetail = state.route === "detail";
  const card = isDetail ? state.current : null;
  const prepared = useMemo(() => prepareCardBody(card), [card]);
  const indexed = isDetail && prepared.sections.length > 0;
  const [recallCard, setRecallCard] = useState(null);
  const [shareCard, setShareCard] = useState(null);
  const [archiveCard, setArchiveCard] = useState(null);
  const sharing = Boolean(card && shareCard === card);
  const recalling = Boolean(card?.question && recallCard === card);
  const selectWikiSource = sourceId => workspace.wikiPage({ sourceId });
  useEffect(() => {
    void workspace.start();
    return () => workspace.destroy();
  }, [workspace]);

  useLayoutEffect(() => {
    if (state.route === "detail" || state.route === "scenarios") workspace.routeContentReady(state.route);
  }, [state.route, state.current, state.scenarioData]);

  function captureLink(event) {
    const link = event.target.closest("a");
    if (!link || event.defaultPrevented || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey || link.target === "_blank" || link.hasAttribute("download")) return;
    const url = new URL(link.href, location.href);
    const route = readRoute(url.href);
    if (url.origin === location.origin && route.kind === "wiki") {
      event.preventDefault();
      void selectWikiSource(url.searchParams.get("source"));
      return;
    }
    if (url.origin !== location.origin || route.kind !== "detail" || route.redirect) return;
    event.preventDefault();
    void workspace.navigate(route.id, { hash: route.hash, focusId: link.id });
  }

  const isAtlas = state.route === "scenarios";
  const isGraph = state.route === "graph";
  return <>
    <a className="skip-link" href="#workspace">跳到正文</a>
    <Layout id="app" className={isDetail || isAtlas || isGraph ? "app app--reading" : "app"} onClick={captureLink}>
      <Layout.Header className="app-header">
        <Brand onClick={event => {
          if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
          event.preventDefault();
          void workspace.listPage();
        }} />
        <Flex align="center" gap={8}>
          <Button id="cards-nav" type="text" size="small" aria-current={state.route === "list" ? "page" : isDetail ? "true" : undefined}
            onClick={() => void workspace.listPage()}>知识卡</Button>
          <Button id="scenarios-nav" type="text" size="small" aria-current={isAtlas ? "page" : undefined}
            onClick={() => { if (!isAtlas) void workspace.scenarioPage(); }}>场景</Button>
          <Button id="graph-nav" type="text" size="small" href="/graph" aria-current={isGraph ? "page" : undefined}
            onClick={event => {
              if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
              event.preventDefault();
              if (!isGraph) void workspace.graphPage();
            }}>图谱</Button>
          <Button id="wiki-nav" type="text" size="small" aria-current={state.route === "wiki" ? "page" : undefined}
            onClick={() => void workspace.wikiPage()}>资料</Button>
          {lifecycleEnabled && onLogout && <Button type="text" size="small" href="/archives">归档列表</Button>}
          {onLogout && <Button className="session-logout" type="text" size="small" onClick={onLogout}>退出登录</Button>}
        </Flex>
        {lifecycleEnabled && onLogout && <ManualDeletionNotice sync={sync} />}
      </Layout.Header>
      <Layout.Content id="workspace" className={isDetail ? "workspace page-workspace detail-workspace" : "workspace page-workspace"}
        tabIndex={-1} aria-label="知识卡工作区" aria-busy={state.navigating}
        onScroll={isAtlas ? workspace.trackScenarioScroll : undefined}>
        {state.route === "list" && <CardList state={state} workspace={workspace}>
          <DocumentMessage message={state.message} workspace={workspace} />
        </CardList>}
        {isGraph && <>
          <DocumentMessage message={state.message} workspace={workspace} />
          <KnowledgeGraph positions={workspace.graphPositions} data={state.graphData} loading={state.graphLoading} error={state.graphError} view={state.graphView}
            onContentReady={workspace.routeContentReady} onViewChange={workspace.setGraphView} onOpenSource={workspace.openGraphSource} onOpenCard={workspace.openGraphCard}
            onBack={workspace.graphBack} canGoBack={state.graphCanGoBack} onRetry={workspace.loadGraph} onOpenList={workspace.listPage} />
        </>}
        {isAtlas && <>
          <DocumentMessage message={state.message} workspace={workspace} />
          <ScenarioAtlas data={state.scenarioData} loading={state.scenarioLoading} error={state.scenarioError}
            position={state.scenarioPosition} onPosition={workspace.setScenarioPosition} onRetry={workspace.loadScenarios}
            cardHref={id => workspace.href("detail", id)} onCrossJump={workspace.jumpToAtlas}
            onBack={workspace.backFromAtlasJump} />
        </>}
        {state.route === "wiki" && <WikiPage command={workspace.command}
          initialSourceId={state.wikiSourceId} onSelectSource={selectWikiSource} />}
        {state.route === "missing" && <Result status="404" title="页面不存在"
          extra={<Button type="primary" onClick={() => void workspace.listPage()}>返回列表</Button>} />}
        {isDetail && <div className={indexed ? "record-page record-page--indexed" : "record-page"}>
          <div className="record-controls">
            <Flex className="record-back" align="center" justify="space-between">
              <Button id="back-to-list" type="text" icon={<ArrowLeftOutlined aria-hidden="true" />} onClick={() => void workspace.backFromCard()}>
                {state.graphReturn ? "返回图谱" : state.scenarioReturn ? "返回图鉴" : "返回列表"}
              </Button>
            </Flex>
            <Flex className="document-toolbar" align="center" justify="space-between" gap={12}>
              <Text id="document-status" type="secondary" role="status" aria-live="polite">
                {state.navigating ? "正在读取…" : ""}
              </Text>
              {card?.shareable && onLogout && <Button type="text" aria-expanded={sharing} aria-controls={sharing ? "card-share-panel" : undefined}
                onClick={() => setShareCard(sharing ? null : card)}>分享</Button>}
              {lifecycleEnabled && card?.canArchive && onLogout &&
                <Button type="text" onClick={() => setArchiveCard(card)}>归档</Button>}
              {lifecycleEnabled && card?.canArchive && onLogout && <DatabaseCardButton key={card.id} cardId={card.id} enabled={Boolean(sync.info)}/>}
              {card?.question && <Button id="try-recall" type="text" onClick={() => setRecallCard(recalling ? null : card)}>
                {recalling ? "返回阅读" : "试着回想"}
              </Button>}
            </Flex>
          </div>
          {sharing && <CardSharePanel key={card.id} cardId={card.id} />}
          {archiveCard && archiveCard === card && <LifecycleDialog action="archive" target={archiveCard}
            onClose={() => setArchiveCard(null)} onConfirmed={operation => {
              location.assign("/archives?operation=" + encodeURIComponent(operation.id));
            }} />}
          <DocumentMessage message={state.message} workspace={workspace} />
          {card && <Reader key={card.id} current={card} prepared={prepared} anchor={state.documentAnchor}
            recalling={recalling} scenarioSourceView={state.scenarioSourceView} scenarioData={state.scenarioRelationsData} workspace={workspace} />}
        </div>}
      </Layout.Content>
    </Layout>
  </>;
}

function ArchiveWorkspace({ onLogout }) {
  const sync = useLifecycleSync(Boolean(onLogout));
  return <Layout className="app lifecycle-page">
    <Layout.Header className="app-header">
      <Brand />
      <Flex align="center" gap={8}>
        <Button type="text" size="small" href="/cards">知识卡</Button>
        <Button type="text" size="small" onClick={onLogout}>退出登录</Button>
      </Flex>
      {onLogout && <ManualDeletionNotice sync={sync} />}
    </Layout.Header>
    <Layout.Content className="workspace page-workspace"><ArchiveList sync={sync} /></Layout.Content>
  </Layout>;
}

const nonce = document.querySelector('meta[name="style-nonce"]')?.content;
const localMode = document.querySelector('meta[name="auth-mode"]')?.content === "local";
const entry = isSharedCardPath(location.pathname) ? <SharedCardPage /> : localMode ? <Workspace workspace={createWorkspace()} /> :
  location.pathname === "/login" ? <LoginPage /> :
    <SessionGate Workspace={lifecycleEnabled && location.pathname === "/archives" ? ArchiveWorkspace : Workspace} />;
createRoot(document.getElementById("root")).render(
  <ConfigProvider locale={zhCN} theme={paperTheme} csp={{ nonce }} button={{ autoInsertSpace: false }}>
    {entry}
  </ConfigProvider>,
);
