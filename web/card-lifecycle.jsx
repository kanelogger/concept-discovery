import React, { useEffect, useId, useRef, useState } from "react";
import { Button } from "./components/ui/button.jsx";
import { lifecycleRequest } from "./lifecycle-sync.mjs";
export { default as stylesheet } from "./card-lifecycle.css?route";

const labels = { archive:"归档", restore:"恢复", purge:"彻底删除", "mark-archive":"补记归档",
  resume:"继续原操作", compensate:"撤销原操作" };
const details = {
  archive:"归档后，常规列表与搜索将隐藏此卡。你仍可从归档列表恢复。",
  restore:"此卡将重新出现在知识库中。",
  purge:"确认前会核对这张卡的原稿和线上副本。已有 Git 历史与离线备份保留。",
  "mark-archive":"把已核实的归档状态补记到原稿。",
  resume:"沿用原操作记录，从已确认的阶段继续。",
  compensate:"根据已核对的原稿和线上状态撤销原操作，并保留无关修改。",
};
const blockers = {
  raw_sync_pending:"线上原稿尚未同步", purge_unavailable:"彻底删除暂时不可用",
  incoming_reference:"有其他原稿直接引用此卡", verified_archive_required:"缺少可核实的归档记录",
  asset_ownership_unverified:"附件归属待核对", asset_destination_conflict:"共享附件迁移路径冲突",
  original_path_unverified:"原稿目录待核对",
  catalogue_reference:"目录引用待核对", raw_missing:"原稿缺失",
};

export function LifecycleDialog({ action, target, onClose, onConfirmed, databaseFirst = false }) {
  const dialog = useRef(null), titleId = useId(), descriptionId = useId();
  const [preview,setPreview] = useState(null), [error,setError] = useState("");
  const [sending,setSending] = useState(false);
  const [attempt,setAttempt] = useState(0);
  const active = useRef(false);
  const purge = action === "purge";
  const settling = action === "resume" || action === "compensate";
  const confirmPassword = purge || settling;
  useEffect(() => {
    const surface = dialog.current;
    active.current = true;
    if (!surface.open) surface.showModal();
    return () => { active.current=false; };
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    lifecycleRequest("/preview",{body:{action,id:target.id},signal:controller.signal})
      .then(setPreview,error => { if (!controller.signal.aborted) setError(error.message); });
    return () => controller.abort();
  }, [action,target.id,attempt]);

  async function confirm(event) {
    event.preventDefault();
    if (!preview?.id || sending) return;
    const form = event.currentTarget;
    setSending(true);
    setError("");
    try {
      const password = confirmPassword ? new FormData(form).get("password") : undefined;
      if (confirmPassword) form.reset();
      const operation = await lifecycleRequest("/confirm",{body:{id:preview.id,password}});
      if (active.current) onConfirmed(operation);
    } catch (failure) {
      if (active.current) setError(failure.message);
    } finally {
      if (active.current) setSending(false);
    }
  }
  return <dialog className="lifecycle-dialog" ref={dialog} aria-labelledby={titleId} aria-describedby={descriptionId}
    onClose={onClose} onCancel={event => { if (sending) event.preventDefault(); }}>
    <h1 id={titleId}>{labels[action]}{!settling && `「${target.title}」`}</h1>
    <p id={descriptionId}>{purge && (databaseFirst || preview?.deferred)
      ? "确认后隐藏卡片并暂停分享。请按右上角提醒在本地删除原稿，再提交并推送到 GitHub。四小时批次核实主分支后继续清理线上副本。"
      : action === "compensate" && databaseFirst
        ? "恢复卡片至确认删除前的状态。已在本地删除或已提交的原稿，请自行核对并恢复。"
        : details[action]}</p>
    {!preview && !error && <p role="status">正在核对操作范围…</p>}
    {preview?.files?.length > 0 && <details open={purge}>
      <summary>{databaseFirst || action === "resume" ? "本次核对的原稿" : "原稿变更"} · {preview.files.length} 项</summary>
      <ul>{preview.files.map(path=><li key={path}>{path}</li>)}</ul>
    </details>}
    {preview?.moves?.length > 0 && <details open>
      <summary>保留的共享附件 · {preview.moves.length} 项</summary>
      <ul>{preview.moves.map(([from,to])=><li key={from}>{from} → {to}</li>)}</ul>
    </details>}
    {preview?.blockers?.length > 0 && <ul className="lifecycle-error">{preview.blockers.map((item,index)=>
      <li key={index}>{item.message || blockers[item.reason] || "有待核对的维护条件"}{item.path && <small>{item.path}</small>}</li>)}</ul>}
    {error && <p role="alert" className="lifecycle-error">{error}</p>}
    <form onSubmit={confirm}>
      {confirmPassword && preview?.id && <label className="lifecycle-password">站主密码
        <input name="password" type="password" autoComplete="current-password" required disabled={sending} />
      </label>}
      <div className="lifecycle-actions">
        <Button autoFocus disabled={sending} onClick={() => dialog.current.close()}>取消</Button>
        {error && !sending && <Button onClick={() => { setPreview(null); setError(""); setAttempt(n=>n+1); }}>重新预览</Button>}
        {preview?.id && <Button type="submit" variant="primary" danger={purge} disabled={sending} aria-busy={sending}>{labels[action]}</Button>}
      </div>
      {sending && <p role="status">正在提交，请稍候。</p>}
    </form>
  </dialog>;
}

const archiveStatuses = {
  archived:"已归档", "from-raw":"仅有归档原稿", "needs-marker":"待补记原稿", "missing-raw":"原稿缺失", "needs-review":"需核对",
  "awaiting-export":"待核实并清理线上副本",
};
const taskStatuses = {
  queued:"已排队", running:"正在处理", complete:"操作已完成", cancelled:"操作已撤回", "needs-review":"操作需要核对",
  "awaiting-export":"卡片已隐藏，线上清理待核实",
};
const formatDate = value => new Date(value).toLocaleDateString("zh-CN", { timeZone:"Asia/Shanghai" });
const formatSyncTime = new Intl.DateTimeFormat("zh-CN",{
  timeZone:"Asia/Shanghai",month:"numeric",day:"numeric",hour:"2-digit",minute:"2-digit",hour12:false,
});
const syncIssueLabels = {
  git_unavailable:"无法读取 Git 远端",git_content_conflict:"Git 和数据库改动冲突",content_conflict:"删除范围需重新核对",
  git_pending:"Git 发布结果待核实",git_refused:"Git 远端拒绝发布",
  native_outcome_unknown:"数据库写入结果待核实",newer_purge_pending:"有卡片已转入待删除",
  shared_dependency_pending:"共享附件涉及本批其他原稿，已顺延到下一批次",
};

function ExportSyncStatus({sync,onReviewPublished}) {
  const {info,unavailable,refresh}=sync;
  const [retrying,setRetrying]=useState(false);
  const [retryError,setRetryError]=useState("");
  if (!info) return null;
  const label=code=>syncIssueLabels[code]??"同步异常，需核对";
  const codesByCard=new Map(info.issues?.map(({rawId,code})=>[rawId,code]));
  for (const rawId of info.issue?.rawIds ?? []) if (!codesByCard.has(rawId)) codesByCard.set(rawId,info.issue.code);
  async function retry(body) {
    if (retrying) return;
    setRetrying(true);
    setRetryError("");
    try {await lifecycleRequest("/sync-resume",{body});refresh();}
    catch (failure) {setRetryError(failure.message);}
    finally {setRetrying(false);}
  }
  return <section className="lifecycle-task" aria-label="原稿同步">
    <h2>原稿同步</h2>
    <p role="status">{unavailable ? "暂时无法读取同步状态。" : info.issue ? label(info.issue.code) : ""}</p>
    <dl>
      <dt>上次成功</dt>
      <dd>{info.lastSuccessAt ? formatSyncTime.format(info.lastSuccessAt) : "暂无记录"}</dd>
      <dt>下次批次（北京时间）</dt>
      <dd>{formatSyncTime.format(info.nextBatchAt)}</dd>
      <dt>待同步操作</dt>
      <dd>{info.pendingCount} 项</dd>
    </dl>
    {codesByCard.size>0 && <ul>
      {[...codesByCard].map(([rawId,code])=><li key={rawId}>{rawId} · {label(code)}
        {info.issues?.some(issue=>issue.rawId===rawId && issue.retryable) &&
          <Button disabled={retrying} onClick={()=>retry({rawId})}>下个批次重新核对</Button>}
      </li>)}
    </ul>}
    {info.issue?.batchId && <Button onClick={()=>retry({batchId:info.issue.batchId})} disabled={retrying} aria-busy={retrying}>重新核对批次</Button>}
    {info.issue?.canReviewPublished &&
      <Button onClick={()=>onReviewPublished(info.issue.batchId)}>重新预览待删范围</Button>}
    {retryError && <p role="alert" className="lifecycle-error">{retryError}</p>}
  </section>;
}

export function DatabaseCardButton({cardId,enabled}) {
  const [open,setOpen]=useState(false);
  if (!enabled) return null;
  return <>
    <Button variant="text" onClick={()=>setOpen(true)}>{cardId?"编辑":"新增卡片"}</Button>
    {open && <DatabaseCardDialog cardId={cardId} onClose={()=>setOpen(false)} />}
  </>;
}

function DatabaseCardDialog({cardId,onClose}) {
  const dialog=useRef(null), active=useRef(false), heading=useId(), titleField=useId(), bodyField=useId();
  const [draft,setDraft]=useState(()=>cardId?null:{title:"",markdown:"## 核心理解\n\n"});
  const [error,setError]=useState(""),[sending,setSending]=useState(false),[intent,setIntent]=useState(null);
  useEffect(()=>{
    active.current=true;
    const surface=dialog.current;
    if (!surface.open) surface.showModal();
    const controller=new AbortController();
    if (cardId) lifecycleRequest("/draft/"+encodeURIComponent(cardId),{signal:controller.signal})
      .then(value=>{if (active.current) setDraft(value);},failure=>{
        if (!controller.signal.aborted) setError(failure.message);
      });
    return ()=>{active.current=false;controller.abort();};
  },[cardId]);
  async function save(event) {
    event.preventDefault();
    if (!draft || sending) return;
    setSending(true);
    setError("");
    try {
      const preview=intent ?? await lifecycleRequest("/database-preview",{body:{
        action:cardId?"edit":"create",id:cardId,...draft,
      }});
      if (!active.current) return;
      setIntent(preview);
      const result=await lifecycleRequest("/confirm",{body:{id:preview.id}});
      if (!active.current) return;
      location.assign(result.state==="complete" && result.progress?.documentId
        ? "/cards/"+encodeURIComponent(result.progress.documentId)
        : "/archives?operation="+encodeURIComponent(result.id));
    } catch (failure) {
      if (active.current) setError(failure.message);
    } finally {
      if (active.current) setSending(false);
    }
  }
  return <dialog className="lifecycle-dialog" ref={dialog} aria-labelledby={heading} onClose={onClose}
    onCancel={event=>{if (sending) event.preventDefault();}}>
    <h1 id={heading}>{cardId?"编辑卡片":"新增卡片"}</h1>
    <p>保存后先更新知识库，原稿在下个四小时批次同步。</p>
    {error && <p role="alert" className="lifecycle-error">{error}</p>}
    <form aria-labelledby={heading} onSubmit={save}>
      {draft && <div className="lifecycle-editor">
        <label htmlFor={titleField}>标题</label>
        <input autoFocus id={titleField} value={draft.title} required maxLength={1000} disabled={sending || !!intent}
          onChange={event=>setDraft({...draft,title:event.target.value})} />
        <label htmlFor={bodyField}>正文（Markdown）</label>
        <textarea id={bodyField} value={draft.markdown} rows={12} required disabled={sending || !!intent}
          onChange={event=>setDraft({...draft,markdown:event.target.value})} />
      </div>}
      <div className="lifecycle-actions">
        <Button disabled={sending} onClick={()=>dialog.current.close()}>关闭</Button>
        {draft && <Button type="submit" variant="primary" disabled={sending} aria-busy={sending}>{intent?"核对保存结果":"保存"}</Button>}
      </div>
    </form>
  </dialog>;
}

export function ArchiveList({sync}) {
  const [list,setList] = useState(null), [error,setError] = useState(""), [refresh,setRefresh] = useState(0);
  const [selection,setSelection] = useState(null);
  const [operation,setOperation] = useState(() => new URLSearchParams(location.search).get("operation"));
  const [task,setTask] = useState(null), [taskError,setTaskError] = useState("");
  const databaseFirst=Boolean(sync.info);
  const refreshSync=sync.refresh;
  useEffect(() => {
    const controller = new AbortController();
    lifecycleRequest("/archives",{signal:controller.signal}).then(setList,failure=>{
      if (!controller.signal.aborted) setError(failure.message);
    });
    return () => controller.abort();
  }, [refresh]);
  useEffect(() => {
    if (!operation) return;
    const controller = new AbortController();
    let timer;
    async function check() {
      try {
        const current = await lifecycleRequest("/operations/"+encodeURIComponent(operation),{signal:controller.signal});
        if (controller.signal.aborted) return;
        if (current.state === "complete" && current.originalId && current.progress?.stage !== "deletion-compensated") {
          setTask(null);
          setOperation(current.originalId);
          history.replaceState(null,"","/archives?operation="+encodeURIComponent(current.originalId));
          return;
        }
        setTask(current);
        setTaskError("");
        if (["queued","running","awaiting-export"].includes(current.state))
          timer=setTimeout(check,current.state==="awaiting-export"?30000:1500);
        else {
          setRefresh(value=>value+1);
          refreshSync();
        }
      } catch (failure) {
        if (!controller.signal.aborted) {
          setTaskError(failure.message);
          timer=setTimeout(check,4000);
        }
      }
    }
    void check();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [operation,refreshSync]);

  function selected(action, card) { setSelection({ action, target:{id:card.rawId,title:card.title} }); }
  function confirmed(current) {
    setSelection(null);
    setTask(current);
    setOperation(current.id);
    setRefresh(value=>value+1);
    refreshSync();
    history.replaceState(null,"","/archives?operation="+encodeURIComponent(current.id));
  }
  return <section className="lifecycle-archive" aria-labelledby="archive-title">
    <h1 id="archive-title">归档列表</h1>
    <DatabaseCardButton enabled={databaseFirst} />
    <ExportSyncStatus sync={sync}
      onReviewPublished={id=>setSelection({action:"resume",target:{id}})} />
    {operation && <div className="lifecycle-task">
      <p role="status">{taskError || (task?.progress?.error === "previous_export_conflict"
        ? "该卡的上一次同步尚未结算。请在批次结算后重新预览删除。"
        : task ? (taskStatuses[task.state] || "正在读取操作状态") : "正在读取操作状态…")}</p>
      {!databaseFirst && task?.state === "needs-review" && !taskError && (task.originalId
        ? <div className="lifecycle-actions">
          <a className="paper-button" href={"/archives?operation="+encodeURIComponent(task.originalId)}>查看原操作</a>
          {task.progress?.stage === "compensation-native" && <Button onClick={()=>setSelection({action:"resume",target:{id:task.id}})}>
            继续撤销
          </Button>}
        </div>
        : <div className="lifecycle-actions">
          {["resume","compensate"].map(action=><Button key={action} onClick={()=>setSelection({action,target:{id:task.id}})}>
            {labels[action]}
          </Button>)}
        </div>)}
    </div>}
    {error && <p role="alert" className="lifecycle-error">{error} <Button onClick={() => {setError("");setRefresh(v=>v+1);}}>重试</Button></p>}
    {list === null && !error && <p role="status">正在读取归档卡…</p>}
    {list?.length === 0 && <p>暂无归档卡。可以在知识卡详情页归档卡片。</p>}
    {list?.length > 0 && <ul className="lifecycle-cards">{list.map(card => <li key={card.rawId}>
      <div><h2>{card.title}</h2><p>
        {card.discipline && <span>{card.discipline}</span>}
        <span>{archiveStatuses[card.state] || archiveStatuses["needs-review"]}</span>
        {card.archivedAt && Number.isFinite(Date.parse(card.archivedAt)) && <time dateTime={card.archivedAt}>{formatDate(card.archivedAt)}</time>}
      </p></div>
      <div className="lifecycle-actions">
        {card.state === "awaiting-export" && card.purgeOperation &&
          <Button onClick={()=>setSelection({action:"compensate",target:{id:card.purgeOperation}})}>撤销待删</Button>}
        {(card.state === "archived" || card.state === "from-raw") &&
          <Button onClick={() => selected("restore",card)}>恢复</Button>}
        {card.state === "needs-marker" && <Button onClick={() => selected("mark-archive",card)}>补记归档</Button>}
        {(card.state === "archived" || card.state === "missing-raw") &&
          <Button danger variant="text" onClick={() => selected("purge",card)}>彻底删除</Button>}
      </div>
    </li>)}</ul>}
    {selection && <LifecycleDialog {...selection} databaseFirst={databaseFirst} onClose={() => setSelection(null)} onConfirmed={confirmed} />}
  </section>;
}
