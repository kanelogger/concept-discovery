import { useEffect, useState } from "react";
import { Button } from "./ui/button.jsx";

function ReloadRoute() {
  return <div className="paper-notice paper-notice--error" role="alert">
    <span>页面组件未能加载</span>
    <Button onClick={() => window.location.reload()}>刷新当前页</Button>
  </div>;
}

const styles = new Map();
function loadStylesheet(url) {
  if (!url) return;
  if (!styles.has(url)) {
    const pending = new Promise((resolve, reject) => {
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = url;
      link.onload = resolve;
      link.onerror = () => reject(new Error("无法加载页面样式"));
      document.head.append(link);
    });
    styles.set(url, pending);
  }
  return styles.get(url);
}

// Data requests start independently in the workspace. Keep a module for this
// tab, and ignore its completion if the reader has already changed routes.
export function lazyRoute(load, name = "default", fallback = <p role="status">正在打开页面…</p>) {
  let component, pending;
  return function Route(props) {
    const [Page, setPage] = useState(() => component);
    useEffect(() => {
      if (Page) return;
      let active = true;
      pending ??= load().then(async module => {
        await loadStylesheet(module.stylesheet);
        return module[name];
      }).catch(() => ReloadRoute).then(result => { component = result; return result; });
      pending.then(result => { if (active) setPage(() => result); });
      return () => { active = false; };
    }, [Page]);
    return Page ? <Page {...props} /> : fallback;
  };
}
