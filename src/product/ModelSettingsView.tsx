import { useEffect, useState } from "react";
import { ArrowLeft, Check, ExternalLink, KeyRound, LoaderCircle, PlugZap, ShieldCheck, Unplug } from "lucide-react";
import type { Locale } from "./model";
import { api } from "./api";
import Modal from "./Modal";

type ModelInfo = { id: string; name: string; reasoning: boolean; contextWindow: number };
type ProviderInfo = { id: string; label: string; authType: "api_key" | "oauth"; connected: boolean; credentialType: string | null; models: ModelInfo[] };
type Settings = { providers: ProviderInfo[]; active: { provider: string; model: string } | null };
type AuthPrompt = { id: string; type: "text" | "secret" | "select" | "manual_code"; message: string; placeholder?: string; options?: { id: string; label: string; description?: string }[] };
type AuthEvent = { cursor: number; type: string; message?: string; links?: { label?: string; url: string }[]; url?: string; instructions?: string; userCode?: string; verificationUri?: string; prompt?: AuthPrompt };
type AuthSession = { sessionId: string; status: string; error: string | null; events: AuthEvent[]; cursor: number };

const words = {
  cn: {
    title: "模型设置", intro: "连接你已订阅的模型服务，或配置 DeepSeek API Key。模型仅在你提交推荐请求或测试连接时接收相应内容。", back: "返回发现", active: "当前用于推荐", use: "设为当前模型", connect: "连接订阅", disconnect: "断开连接", connected: "已连接", disconnected: "未连接", model: "模型", key: "DeepSeek API Key", saveKey: "保存密钥", keyPlaceholder: "输入 API Key；保存后不会再次显示", test: "测试连接", testing: "正在测试…", testHint: "测试会向当前模型发送一条合成任务和测试候选。", success: "连接测试成功", cancel: "取消授权", waiting: "等待服务商授权…", loginFailed: "授权失败，请重试。", authPrompt: "服务商需要以下信息", submit: "提交", empty: "此服务商暂未提供聊天模型目录。", noActive: "选择已连接的提供方和模型后即可使用推荐。", error: "操作失败", subscribed: "订阅登录由服务商网页完成，Concept Discovery 不会保存你的服务商密码。", apiKeySaved: "API Key 已安全保存。", selected: "当前模型已更新。", disconnectedMessage: "提供方已断开。", privacy: "本地凭据保存在此设备的受限目录中，不会返回到网页。"
  },
  en: {
    title: "Model settings", intro: "Connect a model subscription or configure a DeepSeek API key. A model receives content only when you request a recommendation or test the connection.", back: "Back to discovery", active: "Active for recommendations", use: "Use this model", connect: "Connect subscription", disconnect: "Disconnect", connected: "Connected", disconnected: "Not connected", model: "Model", key: "DeepSeek API key", saveKey: "Save key", keyPlaceholder: "Enter an API key; it will not be shown again", test: "Test connection", testing: "Testing…", testHint: "The test sends one synthetic task and candidate to the active model.", success: "Connection test succeeded", cancel: "Cancel login", waiting: "Waiting for provider authorization…", loginFailed: "Login failed. Please retry.", authPrompt: "The provider needs the following information", submit: "Submit", empty: "No chat models are listed for this provider yet.", noActive: "Connect a provider and select a model to enable recommendations.", error: "Operation failed", subscribed: "Subscription login happens on the provider website. Concept Discovery never stores your provider password.", apiKeySaved: "API key saved securely.", selected: "Active model updated.", disconnectedMessage: "Provider disconnected.", privacy: "Credentials are stored in a restricted directory on this device and are never returned to the page."
  },
};

export default function ModelSettingsView({ locale, onBack }: { locale: Locale; onBack: () => void }) {
  const cn = locale === "cn";
  const t = words[locale];
  const [settings, setSettings] = useState<Settings | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [selection, setSelection] = useState<{ provider: string; model: string }>({ provider: "", model: "" });
  const [session, setSession] = useState<AuthSession | null>(null);
  const [promptValue, setPromptValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [disconnectProvider, setDisconnectProvider] = useState<ProviderInfo | null>(null);

  const refresh = async () => {
    const value = await api<Settings>("/api/model-settings");
    setSettings(value);
    setSelection(value.active ?? { provider: "", model: "" });
  };
  useEffect(() => { void refresh().catch((cause) => setError(cause instanceof Error ? cause.message : t.error)); }, []);

  useEffect(() => {
    if (!session || !["running"].includes(session.status)) return;
    let cancelled = false;
    let cursor = session.cursor;
    const poll = async () => {
      while (!cancelled) {
        try {
          const next = await api<AuthSession>(`/api/model-settings/oauth/${encodeURIComponent(session.sessionId)}?after=${cursor}`);
          if (cancelled) return;
          cursor = next.cursor;
          setSession((current) => current?.sessionId === next.sessionId ? { ...next, events: [...current.events, ...next.events] } : current);
          if (next.status !== "running") {
            if (next.status === "completed") { setMessage(t.connected); await refresh(); }
            else if (next.status === "failed") setError(next.error || t.loginFailed);
            return;
          }
        } catch (cause) {
          if (cancelled) return;
          setError(cause instanceof Error ? cause.message : t.loginFailed);
          return;
        }
        await new Promise((resolve) => window.setTimeout(resolve, 700));
      }
    };
    void poll();
    return () => { cancelled = true; };
  }, [session?.sessionId, session?.status]);

  const run = async (action: () => Promise<unknown>, success?: string) => {
    setBusy(true); setError(""); setMessage("");
    try { await action(); if (success) setMessage(success); await refresh(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : t.error); }
    finally { setBusy(false); }
  };
  const saveKey = async (event: React.FormEvent) => {
    event.preventDefault();
    await run(async () => { await api("/api/model-settings/deepseek", { method: "POST", body: JSON.stringify({ apiKey }) }); setApiKey(""); }, t.apiKeySaved);
  };
  const connect = async (provider: string) => {
    await run(async () => {
      const result = await api<{ sessionId: string }>("/api/model-settings/oauth", { method: "POST", body: JSON.stringify({ provider }) });
      setSession({ sessionId: result.sessionId, status: "running", error: null, events: [], cursor: 0 });
    });
  };
  const disconnect = async (provider: string) => {
    await run(() => api(`/api/model-settings/credentials/${encodeURIComponent(provider)}`, { method: "DELETE" }), t.disconnectedMessage);
  };
  const confirmDisconnect = async () => {
    if (!disconnectProvider) return;
    const provider = disconnectProvider;
    setDisconnectProvider(null);
    await disconnect(provider.id);
  };
  const choose = (provider: string, model: string) => setSelection({ provider, model });
  const activate = () => run(() => api("/api/model-settings/selection", { method: "PUT", body: JSON.stringify(selection) }), t.selected);
  const reply = async (event: React.FormEvent, prompt: AuthPrompt) => {
    event.preventDefault();
    if (!session) return;
    await run(async () => {
      await api(`/api/model-settings/oauth/${encodeURIComponent(session.sessionId)}/reply`, { method: "POST", body: JSON.stringify({ promptId: prompt.id, value: promptValue }) });
      setPromptValue("");
      setSession((current) => current ? { ...current, events: current.events.filter((item) => item.prompt?.id !== prompt.id) } : null);
    });
  };
  const cancel = async () => {
    if (!session) return;
    await run(() => api(`/api/model-settings/oauth/${encodeURIComponent(session.sessionId)}`, { method: "DELETE" }));
    setSession(null);
  };
  const test = async () => {
    setBusy(true); setError(""); setMessage("");
    try { await api("/api/model-settings/test", { method: "POST", body: "{}" }); setMessage(t.success); }
    catch (cause) { setError(cause instanceof Error ? cause.message : t.error); }
    finally { setBusy(false); }
  };
  const currentPrompt = [...(session?.events ?? [])].reverse().find((event) => event.type === "prompt")?.prompt;

  return <section className="mx-auto max-w-4xl py-8">
    <button type="button" onClick={onBack} className="mb-6 inline-flex items-center gap-2 text-sm text-brand-800 hover:underline"><ArrowLeft size={16} />{t.back}</button>
    <div className="mb-6"><p className="mb-2 text-[11px] font-semibold uppercase tracking-[.18em] text-brand-800">Model access</p><h1 className="text-3xl font-semibold tracking-tight">{t.title}</h1><p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">{t.intro}</p></div>
    <div className="mb-6 flex gap-3 rounded-xl border border-brand-200 bg-brand-50 p-4 text-sm text-brand-950"><ShieldCheck size={18} className="mt-0.5 shrink-0" /><div><p>{t.subscribed}</p><p className="mt-1 text-xs text-brand-800">{t.privacy}</p></div></div>
    {error && <div className="mb-4 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800"><p role="alert">{error}</p>{!settings && <button type="button" onClick={() => void refresh().catch((cause) => setError(cause instanceof Error ? cause.message : t.error))} className="mt-2 min-h-10 font-semibold text-brand-800 underline">{cn ? "重试读取" : "Retry loading"}</button>}</div>}
    {message && <p role="status" className="mb-4 rounded-lg border border-brand-200 bg-brand-50 p-3 text-sm text-brand-900">{message}</p>}

    {session?.status === "running" && <div className="mb-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="mb-4 flex items-center gap-2 text-sm font-medium"><LoaderCircle size={17} className="animate-spin text-brand-800" />{t.waiting}</div>
      <div className="space-y-3">
        {session.events.map((item) => <div key={item.cursor} className="rounded-lg bg-slate-50 p-3 text-sm">
          {item.type === "info" && <p>{item.message}</p>}
          {item.type === "progress" && <p role="status">{item.message}</p>}
          {item.type === "auth_url" && <a className="inline-flex items-center gap-2 font-medium text-brand-800 underline" href={item.url} target="_blank" rel="noreferrer noopener">{item.instructions || (cn ? "打开服务商授权页" : "Open provider authorization")} <ExternalLink size={14} /></a>}
          {item.type === "device_code" && <div><p>{cn ? "在服务商页面输入此设备码：" : "Enter this device code on the provider page:"}</p><p className="my-2 font-mono text-xl font-semibold tracking-widest">{item.userCode}</p><a href={item.verificationUri} target="_blank" rel="noreferrer noopener" className="text-brand-800 underline">{item.verificationUri}</a></div>}
        </div>)}
      </div>
      {currentPrompt && <form onSubmit={(event) => void reply(event, currentPrompt)} className="mt-4 space-y-3 rounded-xl border border-amber-200 bg-amber-50 p-4">
        <p className="text-sm font-medium text-amber-950">{t.authPrompt}</p><label className="block text-sm text-slate-700">{currentPrompt.message}
          {currentPrompt.type === "select" ? <select required value={promptValue} onChange={(event) => setPromptValue(event.target.value)} className="mt-2 w-full rounded-lg border border-slate-300 bg-white px-3 py-2"> <option value="">{cn ? "请选择" : "Choose"}</option>{currentPrompt.options?.map((option) => <option key={option.id} value={option.id}>{option.label}{option.description ? ` — ${option.description}` : ""}</option>)}</select> : <input required autoComplete="off" type={currentPrompt.type === "secret" || currentPrompt.type === "manual_code" ? "password" : "text"} value={promptValue} placeholder={currentPrompt.placeholder} onChange={(event) => setPromptValue(event.target.value)} className="mt-2 w-full rounded-lg border border-slate-300 bg-white px-3 py-2" />}
        </label><button disabled={busy} className="rounded-lg bg-brand-900 px-4 py-2 text-sm text-white disabled:opacity-50">{t.submit}</button>
      </form>}
      <button type="button" onClick={() => void cancel()} className="mt-4 text-sm text-slate-600 underline">{t.cancel}</button>
    </div>}

    <div className="space-y-4">
      {settings?.providers.map((provider) => {
        const selected = settings.active?.provider === provider.id;
        const selectedModel = selection.provider === provider.id ? selection.model : "";
        return <article key={provider.id} className={`rounded-2xl border bg-white p-5 shadow-sm ${selected ? "border-brand-700 ring-1 ring-brand-700" : "border-slate-200"}`}>
          <header className="flex flex-wrap items-start justify-between gap-3">
            <div><h2 className="text-lg font-semibold">{provider.label}</h2><p className={`mt-1 inline-flex items-center gap-1.5 text-xs ${provider.connected ? "text-success-800" : "text-slate-600"}`}>{provider.connected ? <Check size={14} /> : <PlugZap size={14} />}{provider.connected ? t.connected : t.disconnected}{selected && <span className="ml-2 rounded-full bg-brand-50 px-2 py-0.5 text-brand-800">{t.active}</span>}</p></div>
            {provider.id !== "deepseek" && !provider.connected && <button disabled={busy || Boolean(session?.status === "running")} type="button" onClick={() => void connect(provider.id)} className="inline-flex items-center gap-2 rounded-lg bg-brand-900 px-3 py-2 text-sm text-white disabled:opacity-50"><PlugZap size={15} />{t.connect}</button>}
            {provider.connected && <button disabled={busy} type="button" onClick={() => setDisconnectProvider(provider)} className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-slate-300 px-3 text-sm font-semibold text-slate-700 hover:bg-surface-soft disabled:opacity-50"><Unplug size={15} />{t.disconnect}</button>}
          </header>
          {provider.id === "deepseek" && <form onSubmit={(event) => void saveKey(event)} className="mt-4 flex flex-wrap gap-2"><label className="sr-only" htmlFor="deepseek-api-key">{t.key}</label><input id="deepseek-api-key" type="password" autoComplete="new-password" value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder={t.keyPlaceholder} className="min-w-56 flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm" /><button disabled={busy || !apiKey.trim()} className="inline-flex items-center gap-2 rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium disabled:opacity-50"><KeyRound size={15} />{t.saveKey}</button></form>}
          {provider.connected && <div className="mt-4 flex flex-wrap items-end gap-2"><label className="min-w-56 flex-1 text-sm text-slate-600">{t.model}<select value={selectedModel} onChange={(event) => choose(provider.id, event.target.value)} className="mt-1 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"><option value="">{cn ? "选择模型" : "Select a model"}</option>{provider.models.map((model) => <option key={model.id} value={model.id}>{model.name || model.id} · {model.id}</option>)}</select></label><button type="button" disabled={busy || !selectedModel || (settings.active?.provider === provider.id && settings.active?.model === selectedModel)} onClick={() => void activate()} className="rounded-lg bg-slate-900 px-3 py-2 text-sm text-white disabled:opacity-40">{t.use}</button></div>}
          {provider.connected && provider.models.length === 0 && <p className="mt-4 text-sm text-slate-500">{t.empty}</p>}
        </article>;
      })}
    </div>
    <div className="mt-6 rounded-2xl border border-slate-200 bg-white p-5">
      {!settings?.active && <p className="mb-4 text-sm text-slate-600">{t.noActive}</p>}
      <button type="button" disabled={busy || !settings?.active || !settings.providers.some((provider) => provider.id === settings.active?.provider && provider.connected)} onClick={() => void test()} className="inline-flex items-center gap-2 rounded-lg border border-brand-800 px-4 py-2.5 text-sm font-medium text-brand-900 hover:bg-brand-50 disabled:opacity-40"><PlugZap size={16} />{busy ? t.testing : t.test}</button>
      <p className="mt-2 text-xs text-slate-500">{t.testHint}</p>
    </div>
    {disconnectProvider && <Modal title={t.disconnect} onClose={() => setDisconnectProvider(null)} className="max-w-md"><div className="p-6"><p className="font-semibold text-ink">{disconnectProvider.label}</p><p className="mt-3 text-sm leading-7 text-slate-700">{cn ? "断开后会从此设备移除此提供方保存的凭据。此操作不会删除知识库内容。" : "Disconnecting removes this provider's saved credentials from this device. It does not affect Registry content."}</p><div className="mt-6 flex justify-end gap-2"><button type="button" onClick={() => setDisconnectProvider(null)} className="min-h-11 rounded-lg border border-slate-300 px-4 text-sm font-semibold text-slate-800">{t.cancel}</button><button type="button" onClick={() => void confirmDisconnect()} disabled={busy} className="min-h-11 rounded-lg bg-rose-800 px-4 text-sm font-semibold text-white disabled:opacity-50">{t.disconnect}</button></div></div></Modal>}
  </section>;
}
