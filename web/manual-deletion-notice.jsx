import React, { useEffect, useId, useRef, useState } from "react";
import { Button } from "./components/ui/button.jsx";
export { default as stylesheet } from "./card-lifecycle.css?route";

function DeletionCommand({ text }) {
  const command = useRef(null);
  const [feedback, setFeedback] = useState("");

  async function copy() {
    const field = command.current;
    try {
      await navigator.clipboard.writeText(text);
      if (field.isConnected) setFeedback("已复制");
    } catch {
      if (!field.isConnected) return;
      field.focus();
      const range = document.createRange();
      range.selectNodeContents(field);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      setFeedback("请手动复制选中的命令");
    }
  }

  return <>
    <pre ref={command} tabIndex={0} aria-label="删除命令"><code>{text}</code></pre>
    <div className="manual-deletion-copy">
      <Button size="small" onClick={copy}>复制命令</Button>
      <span role="status">{feedback}</span>
    </div>
  </>;
}

function DeletionItem({ item, unavailable }) {
  const heading = useId();
  return <section className="manual-deletion-item" aria-labelledby={heading}>
    <h2 id={heading}>{item.title || item.rawId}</h2>
    {unavailable ? <p>暂时无法核实删除范围。</p> : <>
      {item.paths.length > 0 && <ul aria-label="原稿路径">{item.paths.map(path =>
        <li key={path}><code>{path}</code></li>
      )}</ul>}
      {item.command ? <DeletionCommand key={item.command} text={item.command} />
        : <p>删除范围待核对。核实后会在这里显示命令。</p>}
    </>}
  </section>;
}

function DeletionDialog({ items, unavailable, refresh, onClose }) {
  const dialog = useRef(null);
  const title = useId();
  useEffect(() => {
    dialog.current.showModal();
  }, []);
  return <dialog className="lifecycle-dialog manual-deletions-dialog" ref={dialog}
    aria-labelledby={title} onClose={onClose}>
    <div className="manual-deletion-heading">
      <h1 id={title}>待手动删除的原稿</h1>
      <Button autoFocus size="small" onClick={() => dialog.current.close()}>关闭</Button>
    </div>
    {items.length > 0 && <p>在本地仓库根目录执行对应卡片的命令，然后自行提交并推送到 GitHub。网站核实主分支已移除这些路径后清除提醒。线上清理进度请查看归档列表。</p>}
    {items.map(item => <DeletionItem key={item.rawId} item={item} unavailable={unavailable} />)}
    {!items.length && <p role="status">当前没有待手动删除的原稿。</p>}
    {unavailable && <Button onClick={refresh}>重新读取状态</Button>}
  </dialog>;
}

export function ManualDeletionNotice({ sync }) {
  const [open, setOpen] = useState(false);
  const trigger = useRef(null);
  const fallbackFocus = useRef(null);
  const items = sync.info?.manualDeletions ?? [];
  return <>
    {items.length > 0 && <Button ref={trigger} className="manual-deletion-trigger" size="small"
      aria-haspopup="dialog"
      onClick={event => {
        fallbackFocus.current = event.currentTarget.closest("header")?.querySelector(".brand");
        setOpen(true);
      }}>原稿待删 · {items.length}</Button>}
    {open && <DeletionDialog items={items} unavailable={sync.unavailable} refresh={sync.refresh}
      onClose={() => {
        setOpen(false);
        if (!trigger.current) fallbackFocus.current?.focus();
      }} />}
  </>;
}
