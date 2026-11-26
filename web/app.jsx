import { useEffect, useSyncExternalStore } from "react";
import { createRoot } from "react-dom/client";
import { createWorkspace } from "./workspace.mjs";
import { readRoute } from "./routes.mjs";
import { SessionGate } from "./session.jsx";
import { useLifecycleSync } from "./lifecycle-sync.mjs";
import { isSharedCardPath } from "./share-path.mjs";
import { lazyRoute } from "./components/lazy-route.jsx";
import { Button } from "./components/ui/button.jsx";

const lifecycleEnabled = document.querySelector('meta[name="card-lifecycle"]')?.content === "enabled";
const LoginPage = lazyRoute(() => import("./login.jsx"));
const CardList = lazyRoute(() => import("./card-list.jsx"));
const CardReader = lazyRoute(() => import("./card-reader.jsx"));
const KnowledgeGraph = lazyRoute(() => import("./knowledge-graph.jsx"));
const ScenarioAtlas = lazyRoute(() => import("./scenario-atlas.jsx"), "ScenarioAtlas");
const WikiPage = lazyRoute(() => import("./wiki.jsx"));
const SharedCardPage = lazyRoute(() => import("./card-share.jsx"), "SharedCardPage");
const ArchiveList = lazyRoute(() => import("./card-lifecycle.jsx"), "ArchiveList");
const ManualDeletionNotice = lazyRoute(() => import("./manual-deletion-notice.jsx"), "ManualDeletionNotice", null);
const navLink = "paper-button paper-button--text paper-button--small";

function Brand({ onClick }) {
  return <a className="brand" href="/" id={onClick ? "home-link" : undefined} onClick={onClick}>
    <img className="brand-mark" src="/favicon.svg" width="32" height="32" alt="" />
    <span>Concept Discovery</span>
  </a>;
}

function DocumentMessage({ message, workspace }) {
  if (!message) return null;
  return <div id="document-message" role={message.error ? "alert" : "status"}
    className={`document-message paper-notice${message.error ? " paper-notice--error" : ""}`}>
    <span id="document-message-text">{message.text}</span>
    {message.reload && <Button id="reload-document" size="small" onClick={() => void workspace.reload()}>重新读取</Button>}
  </div>;
}

function Workspace({ workspace, onLogout }) {
  const ownerMaintenance = lifecycleEnabled && Boolean(onLogout);
  const sync = useLifecycleSync(ownerMaintenance);
  const state = useSyncExternalStore(workspace.subscribe, workspace.getSnapshot);
  const isDetail = state.route === "detail";
  const isAtlas = state.route === "scenarios";
  const isGraph = state.route === "graph";
  const selectWikiSource = sourceId => workspace.wikiPage({ sourceId });
  useEffect(() => {
    void workspace.start();
    return () => workspace.destroy();
  }, [workspace]);

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

  const notice = <DocumentMessage message={state.message} workspace={workspace} />;
  return <>
    <a className="skip-link" href="#workspace">跳到正文</a>
    <div id="app" className={isDetail || isAtlas || isGraph ? "app app--reading" : "app"} onClick={captureLink}>
      <header className="app-header">
        <Brand onClick={event => {
          if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
          event.preventDefault();
          void workspace.listPage();
        }} />
        <nav className="app-nav" aria-label="主导航">
          <Button id="cards-nav" variant="text" size="small" aria-current={state.route === "list" ? "page" : isDetail ? "true" : undefined}
            onClick={() => void workspace.listPage()}>知识卡</Button>
          <Button id="scenarios-nav" variant="text" size="small" aria-current={isAtlas ? "page" : undefined}
            onClick={() => { if (!isAtlas) void workspace.scenarioPage(); }}>场景</Button>
          <a id="graph-nav" className={navLink} href="/graph" aria-current={isGraph ? "page" : undefined}
            onClick={event => {
              if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
              event.preventDefault();
              if (!isGraph) void workspace.graphPage();
            }}>图谱</a>
          <Button id="wiki-nav" variant="text" size="small" aria-current={state.route === "wiki" ? "page" : undefined}
            onClick={() => void workspace.wikiPage()}>资料</Button>
          {ownerMaintenance && <a className={navLink} href="/archives">归档列表</a>}
          {onLogout && <Button className="session-logout" variant="text" size="small" onClick={onLogout}>退出登录</Button>}
        </nav>
        {ownerMaintenance && <ManualDeletionNotice sync={sync} />}
      </header>
      <main id="workspace" className={isDetail ? "workspace page-workspace detail-workspace" : "workspace page-workspace"}
        tabIndex={-1} aria-label="知识卡工作区" aria-busy={state.navigating}
        onScroll={isAtlas ? workspace.trackScenarioScroll : undefined}>
        {state.route === "list" && <CardList state={state} workspace={workspace}>{notice}</CardList>}
        {isGraph && <>
          {notice}
          <KnowledgeGraph positions={workspace.graphPositions} data={state.graphData} loading={state.graphLoading} error={state.graphError} view={state.graphView}
            onContentReady={workspace.routeContentReady} onViewChange={workspace.setGraphView} onOpenSource={workspace.openGraphSource} onOpenCard={workspace.openGraphCard}
            onBack={workspace.graphBack} canGoBack={state.graphCanGoBack} onRetry={workspace.loadGraph} onOpenList={workspace.listPage} />
        </>}
        {isAtlas && <>
          {notice}
          <ScenarioAtlas data={state.scenarioData} loading={state.scenarioLoading} error={state.scenarioError}
            onContentReady={workspace.routeContentReady} position={state.scenarioPosition} onPosition={workspace.setScenarioPosition}
            onRetry={workspace.loadScenarios} cardHref={id => workspace.href("detail", id)} onCrossJump={workspace.jumpToAtlas}
            onBack={workspace.backFromAtlasJump} />
        </>}
        {state.route === "wiki" && <WikiPage command={workspace.command}
          initialSourceId={state.wikiSourceId} onSelectSource={selectWikiSource} />}
        {state.route === "missing" && <section className="missing-page">
          <h1>页面不存在</h1>
          <Button variant="primary" onClick={() => void workspace.listPage()}>返回列表</Button>
        </section>}
        {isDetail && <CardReader state={state} workspace={workspace} owner={Boolean(onLogout)}
          ownerMaintenance={ownerMaintenance} databaseFirst={Boolean(sync.info)}>{notice}</CardReader>}
      </main>
    </div>
  </>;
}

function ArchiveWorkspace({ onLogout }) {
  const sync = useLifecycleSync(Boolean(onLogout));
  return <div className="app lifecycle-page">
    <header className="app-header">
      <Brand />
      <nav className="app-nav" aria-label="主导航">
        <a className={navLink} href="/cards">知识卡</a>
        <Button variant="text" size="small" onClick={onLogout}>退出登录</Button>
      </nav>
      {onLogout && <ManualDeletionNotice sync={sync} />}
    </header>
    <main className="workspace page-workspace"><ArchiveList sync={sync} /></main>
  </div>;
}

const localMode = document.querySelector('meta[name="auth-mode"]')?.content === "local";
const entry = isSharedCardPath(location.pathname) ? <SharedCardPage /> : localMode ? <Workspace workspace={createWorkspace()} /> :
  location.pathname === "/login" ? <LoginPage /> :
    <SessionGate Workspace={lifecycleEnabled && location.pathname === "/archives" ? ArchiveWorkspace : Workspace} />;
createRoot(document.getElementById("root")).render(entry);
