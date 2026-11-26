import { Fragment, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Button } from "./components/ui/button.jsx";
import { formatDate } from "./workspace.mjs";
import { pageSize } from "./routes.mjs";
import { TagChip } from "./tag-chip.jsx";
import "./card-list.css";

function KeywordSearch({ query, workspace }) {
  const composing = useRef(false);
  const [draft, setDraft] = useState("");
  return <form className="keyword-field" onSubmit={event => {
    event.preventDefault();
    if (!composing.current) void workspace.setQuery(event.currentTarget.elements.keyword.value, { immediate: true });
  }}>
    <label htmlFor="search-input">关键词</label>
    <div className="keyword-control">
      <input id="search-input" name="keyword" type="search" placeholder="搜索标题、正文和补充阅读" maxLength={1000}
        value={composing.current ? draft : query}
        onCompositionStart={event => {
          composing.current = true;
          setDraft(event.currentTarget.value);
          workspace.pauseQuery();
        }}
        onCompositionEnd={event => {
          composing.current = false;
          void workspace.setQuery(event.currentTarget.value);
        }}
        onKeyDown={event => {
          if (event.key === "Enter" && (composing.current || event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229))
            event.preventDefault();
        }}
        onChange={event => {
          const value = event.currentTarget.value;
          if (composing.current) setDraft(value);
          else if (value !== workspace.getSnapshot().query) void workspace.setQuery(value);
        }} />
      <button type="submit" className="search-submit" aria-label="搜索"><span aria-hidden="true" /></button>
    </div>
  </form>;
}

function TagFilter({ state, workspace }) {
  const [open, setOpen] = useState(false);
  const field = useRef(null);
  const trigger = useRef(null);
  const tags = state.tag && !state.tags.includes(state.tag) ? [state.tag, ...state.tags] : state.tags;
  useEffect(() => {
    if (!open) return;
    function dismiss(event) {
      if (!field.current.contains(event.target)) setOpen(false);
    }
    document.addEventListener("pointerdown", dismiss);
    return () => document.removeEventListener("pointerdown", dismiss);
  }, [open]);

  function close() {
    trigger.current.focus();
    setOpen(false);
  }
  function toggle() {
    if (!open) void workspace.loadListTags();
    setOpen(!open);
  }
  function choose(tag) {
    close();
    if (tag !== state.tag) void workspace.applyFilters({ tag });
  }
  function onKeyDown(event) {
    if (event.key === "Escape" && open) {
      event.preventDefault();
      close();
    } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (!open) { toggle(); return; }
      const choices = Array.from(field.current.querySelectorAll(".tag-options button"));
      const current = choices.indexOf(event.target);
      const next = current < 0
        ? choices.findIndex(button => button.getAttribute("aria-pressed") === "true")
        : (current + (event.key === "ArrowDown" ? 1 : -1) + choices.length) % choices.length;
      choices[next]?.focus();
    }
  }
  return <div ref={field} className="tag-field" onKeyDown={onKeyDown}
    onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false); }}>
    <label id="tag-label" htmlFor="tag-filter">标签</label>
    <button type="button" id="tag-filter" ref={trigger} className="tag-trigger"
      aria-labelledby="tag-label tag-value" aria-expanded={open} aria-controls="tag-options" onClick={toggle}>
      <span id="tag-value">{state.tag || "全部标签"}</span>
    </button>
    {open && <div id="tag-options" className="tag-options" role="group" aria-labelledby="tag-label">
      <button type="button" aria-pressed={!state.tag} onClick={() => choose("")}>全部标签</button>
      {tags.map(tag => <button type="button" key={tag} aria-pressed={tag === state.tag} onClick={() => choose(tag)}>{tag}</button>)}
      {state.tagsLoading && <p role="status">正在读取标签…</p>}
      {state.tagsError && <div role="alert">{state.tagsError} <button type="button" onClick={() => {
        trigger.current.focus();
        void workspace.loadListTags();
      }}>重试标签</button></div>}
      {!tags.length && !state.tagsLoading && !state.tagsError && <p>暂无标签</p>}
    </div>}
  </div>;
}

function PageNavigation({ page, total, loading, changePage }) {
  const last = Math.max(1, Math.ceil(total / pageSize));
  const firstNumber = Math.max(1, Math.min(page - 2, last - 4));
  const numbers = [1, ...Array.from({ length: Math.min(last, 5) }, (_, i) => firstNumber + i), last];
  const visible = [...new Set(numbers)];
  return <nav className="pagination" aria-label="列表分页">
    <button type="button" aria-label="上一页" disabled={loading || page <= 1}
      onClick={() => changePage(page - 1)}>‹</button>
    {visible.map((number, i) => <Fragment key={number}>
      {number - visible[i - 1] > 1 && <span aria-hidden="true">…</span>}
      <button type="button" aria-current={number === page ? "page" : undefined} aria-label={`第 ${number} 页`}
        disabled={loading} onClick={() => { if (number !== page) changePage(number); }}>{number}</button>
    </Fragment>)}
    <button type="button" aria-label="下一页" disabled={loading || page >= last}
      onClick={() => changePage(page + 1)}>›</button>
  </nav>;
}

export default function CardList({ state, workspace, children }) {
  const list = useRef(null);
  const pendingPage = useRef(null);
  useLayoutEffect(() => {
    workspace.routeContentReady("list");
    if (pendingPage.current === null || state.listLoading) return;
    const active = document.activeElement;
    if (pendingPage.current === state.page && (active === document.body || active.closest(".pagination")))
      list.current.querySelector(".card-title-link, #retry-list")?.focus();
    pendingPage.current = null;
  }, [workspace, state.items, state.listLoading, state.listError, state.page]);

  const { updatedFrom, updatedTo } = state;
  const hasDateRange = updatedFrom !== updatedTo;
  return <section id="list-page" className="list-page" ref={list}>
    <h1 className="page-heading">知识卡</h1>
    {children}
    <search id="search-form" className="list-filters">
      <KeywordSearch query={state.query} workspace={workspace} />
      <TagFilter state={state} workspace={workspace} />
      <div className="date-field">
        <label htmlFor="updated-date">更新日期</label>
        <div className="date-control">
          <input id="updated-date" type="date" value={hasDateRange ? "" : updatedFrom}
            aria-describedby={hasDateRange ? "active-date-range" : undefined}
            onChange={event => {
              const day = event.currentTarget.value;
              void workspace.applyFilters({ updatedFrom: day, updatedTo: day });
            }} />
          {(hasDateRange || !updatedFrom) && <span aria-hidden="true">请选择日期</span>}
        </div>
      </div>
      <Button id="clear-search" variant="text"
        onClick={() => void workspace.applyFilters({ query: "", tag: "", updatedFrom: "", updatedTo: "" })}>重置</Button>
      {hasDateRange && <span id="active-date-range" className="active-date-range">
        当前按更新日期范围筛选（{updatedFrom || "不限"} 至 {updatedTo || "不限"}）。
      </span>}
    </search>
    <div className="list-meta" role="status">
      {state.listLoading ? "正在读取…" : `共 ${state.total} 张知识卡${state.listRefreshing ? " · 正在更新…" : ""}`}
    </div>
    <div className="list-table-wrap">
      <table id="card-list" aria-label="知识卡列表" aria-busy={state.listLoading}>
        <colgroup><col className="title-column" /><col className="tags-column" /><col className="date-column" /><col /></colgroup>
        <thead><tr>
          <th scope="col">标题</th><th scope="col">标签</th><th scope="col">更新时间</th>
          <th scope="col"><span className="visually-hidden">操作</span></th>
        </tr></thead>
        <tbody>{state.items.map(item => {
          const href = workspace.href("detail", item.id);
          return <tr key={item.id}>
            <td><a className="card-title-link" href={href} data-card-id={item.id}>{item.title || "未命名卡片"}</a></td>
            <td>{item.tags?.length
              ? <div className="row-tags">{item.tags.map(tag => <TagChip key={tag} tag={tag} />)}</div>
              : <span className="list-secondary">未设置</span>}</td>
            <td className="updated-cell">{formatDate(item.updated)}</td>
            <td><a href={href}>查看</a></td>
          </tr>;
        })}</tbody>
      </table>
      {!state.items.length && !state.listLoading && !state.listError && <p id="list-message" className="list-empty">{state.listMessage}</p>}
    </div>
    {state.listError && <div id="list-message" className="list-alert" role="alert">{state.listMessage}
      <Button id="retry-list" size="small" onClick={() => void workspace.loadList()}>重新读取</Button>
    </div>}
    <PageNavigation page={state.page} total={state.total} loading={state.listLoading} changePage={page => {
      pendingPage.current = page;
      void workspace.applyFilters({ page });
    }} />
  </section>;
}
