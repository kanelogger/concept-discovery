import { useCallback, useEffect, useState } from "react";

export async function lifecycleRequest(path, {body,signal} = {}) {
  const res = await fetch("/api/card-lifecycle" + path, {
    method:body ? "POST" : "GET", signal, credentials:"same-origin",
    ...(body && {headers:{"Content-Type":"application/json"},body:JSON.stringify(body)}),
  });
  const result = await res.json();
  if (!res.ok || !result.ok) throw new Error(result.error?.message ?? "维护服务暂不可用。");
  return result.data;
}

export function useLifecycleSync(owner) {
  const [info,setInfo]=useState(null);
  const [unavailable,setUnavailable]=useState(false);
  const [attempt,setAttempt]=useState(0);
  const refresh=useCallback(()=>setAttempt(value=>value+1),[]);
  useEffect(()=>{
    if (!owner) {
      // A focus check temporarily hides the same session. Retain the editor's
      // mode while requiring a fresh read before showing another raw command.
      setUnavailable(true);
      return;
    }
    const controller=new AbortController();
    let timer;
    async function check() {
      try {
        const result=await lifecycleRequest("/sync-status",{signal:controller.signal});
        if (controller.signal.aborted) return;
        setInfo(result.enabled ? result : null);
        setUnavailable(false);
        if (!result.enabled) return;
      } catch {
        if (controller.signal.aborted) return;
        setUnavailable(true);
      }
      timer=setTimeout(check,30000);
    }
    void check();
    return ()=>{controller.abort();clearTimeout(timer);};
  },[owner,attempt]);
  return {info,unavailable,refresh};
}
