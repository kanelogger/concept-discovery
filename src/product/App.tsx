import { useEffect, useState } from "react";
import { BookOpen, Check, Compass, Pencil, Plus, RefreshCw, X } from "lucide-react";

type Locale = "cn" | "en";
type LocaleData = { name: string; aliases: string[]; description: string; cover_image: string; wiki_url: string; tags: string[]; trigger: string[]; avoid_when: string[]; transform: string[]; agent_instruction: string; source_text: string };
type Concept = { id: string; lifecycle_status: "active" | "archived"; interaction_type: string | null; epistemic_type: string | null; domains: string[]; intents: string[]; locales: Record<Locale, LocaleData>; version: number; created_at: string; updated_at: string; readiness: Record<Locale, { browsable: boolean; recommendable: boolean; browse_missing: string[]; recommend_missing: string[] }> };
type Draft = { id: string; cnName: string; enName: string; cnDescription: string; enDescription: string; cnSource: string; enSource: string; interactionType: string; epistemicType: string; domains: string[]; intents: string[] };

const blank: Draft = { id: "", cnName: "", enName: "", cnDescription: "", enDescription: "", cnSource: "", enSource: "", interactionType: "", epistemicType: "", domains: [], intents: [] };
const fromConcept = (concept: Concept): Draft => ({ id: concept.id, cnName: concept.locales.cn.name, enName: concept.locales.en.name, cnDescription: concept.locales.cn.description, enDescription: concept.locales.en.description, cnSource: concept.locales.cn.source_text, enSource: concept.locales.en.source_text, interactionType: concept.interaction_type ?? "", epistemicType: concept.epistemic_type ?? "", domains: concept.domains, intents: concept.intents });
const fields: [keyof Draft, string][] = [["cnName", "locales.cn.name"], ["enName", "locales.en.name"], ["cnDescription", "locales.cn.description"], ["enDescription", "locales.en.description"], ["cnSource", "locales.cn.source_text"], ["enSource", "locales.en.source_text"], ["interactionType", "interaction_type"], ["epistemicType", "epistemic_type"], ["domains", "domains"], ["intents", "intents"]];

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, { ...init, headers: { "Content-Type": "application/json", ...init?.headers } });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.message || "Request failed");
  return payload as T;
}

function App() {
  const [locale, setLocale] = useState<Locale>("cn");
  const [concepts, setConcepts] = useState<Concept[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editor, setEditor] = useState<Concept | "create" | null>(null);
  const [draft, setDraft] = useState<Draft>(blank);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [revisions, setRevisions] = useState<{ version_after: number; changed_at: string; changes: { path: string }[] }[]>([]);
  const selected = concepts.find((item) => item.id === selectedId) ?? null;

  const refresh = async () => {
    const result = await api<{ concepts: Concept[] }>("/api/concepts");
    setConcepts(result.concepts);
    setLoading(false);
  };
  useEffect(() => { refresh().catch((cause) => { setError(cause.message); setLoading(false); }); }, []);
  useEffect(() => {
    if (!selectedId) { setRevisions([]); return; }
    api<{ revisions: typeof revisions }>(`/api/concepts/${encodeURIComponent(selectedId)}/revisions`).then((result) => setRevisions(result.revisions)).catch(() => setRevisions([]));
  }, [selectedId, concepts]);

  const begin = (concept?: Concept) => { setError(""); setEditor(concept ?? "create"); setDraft(concept ? fromConcept(concept) : { ...blank }); };
  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true); setError("");
    try {
      let saved: Concept;
      if (editor === "create") {
        saved = await api<Concept>("/api/concepts", { method: "POST", body: JSON.stringify({ id: draft.id, interaction_type: draft.interactionType || null, epistemic_type: draft.epistemicType || null, domains: draft.domains, intents: draft.intents, locales: { cn: { name: draft.cnName, description: draft.cnDescription, source_text: draft.cnSource }, en: { name: draft.enName, description: draft.enDescription, source_text: draft.enSource } } }) });
      } else if (editor) {
        const previous = fromConcept(editor);
        const changes: Record<string, unknown> = {};
        for (const [key, path] of fields) if (JSON.stringify(draft[key]) !== JSON.stringify(previous[key])) changes[path] = key === "interactionType" || key === "epistemicType" ? draft[key] || null : draft[key];
        saved = await api<Concept>(`/api/concepts/${encodeURIComponent(editor.id)}`, { method: "PATCH", body: JSON.stringify({ expected_version: editor.version, changes }) });
      } else return;
      await refresh();
      setSelectedId(saved.id);
      setEditor(null);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Save failed"); }
    finally { setBusy(false); }
  };
  const setField = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft((current) => ({ ...current, [key]: value }));
  const list = concepts.filter((concept) => concept.lifecycle_status === "active");

  return <div className="min-h-screen bg-[#f7f8f5] text-slate-900">
    <header className="sticky top-0 z-20 flex h-16 items-center justify-between border-b border-slate-200 bg-white/95 px-5 backdrop-blur md:px-10">
      <div className="flex items-center gap-3"><div className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-900 text-white"><Compass size={19} /></div><div><div className="text-sm font-semibold">Concept Discovery</div><div className="text-[11px] text-slate-500">Local Registry</div></div></div>
      <div className="flex items-center gap-2"><button type="button" onClick={() => setLocale("cn")} aria-pressed={locale === "cn"} className={`rounded-lg px-3 py-2 text-xs ${locale === "cn" ? "bg-emerald-900 text-white" : "text-slate-500 hover:bg-slate-100"}`}>中文</button><button type="button" onClick={() => setLocale("en")} aria-pressed={locale === "en"} className={`rounded-lg px-3 py-2 text-xs ${locale === "en" ? "bg-emerald-900 text-white" : "text-slate-500 hover:bg-slate-100"}`}>English</button></div>
    </header>
    <main className="mx-auto max-w-6xl px-5 py-10 md:px-10">
      <div className="mb-8 flex flex-wrap items-end justify-between gap-4"><div><div className="mb-2 text-[11px] font-semibold uppercase tracking-[.18em] text-emerald-800">Concept Registry</div><h1 className="text-3xl font-semibold tracking-tight">{locale === "cn" ? "管理 Concept 草稿" : "Manage Concept drafts"}</h1><p className="mt-2 text-sm text-slate-500">{locale === "cn" ? "按语言补齐内容。所有修改保存在本地 Registry。" : "Complete each language independently. Changes are saved in the local Registry."}</p></div><button onClick={() => begin()} className="inline-flex items-center gap-2 rounded-xl bg-emerald-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-emerald-800"><Plus size={16} />{locale === "cn" ? "新建 Concept" : "New Concept"}</button></div>
      {error && !editor && <p role="alert" className="mb-5 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">{error}</p>}
      {loading ? <p className="text-sm text-slate-500">Loading…</p> : list.length === 0 ? <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-6 py-20 text-center"><BookOpen className="mx-auto mb-4 text-emerald-800" size={28} /><h2 className="font-medium">{locale === "cn" ? "目录尚无 Concept" : "No Concepts yet"}</h2><p className="mt-2 text-sm text-slate-500">{locale === "cn" ? "创建一个有名称的草稿。" : "Create a draft with a name."}</p></div> : <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">{list.map((concept) => <button key={concept.id} onClick={() => setSelectedId(concept.id)} className={`min-h-48 rounded-2xl border bg-white p-5 text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-md ${selectedId === concept.id ? "border-emerald-800" : "border-slate-200"}`}><div className="mb-6 flex items-start justify-between"><div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-50 text-emerald-900"><BookOpen size={20} /></div><span className="rounded-full bg-amber-50 px-2.5 py-1 text-[11px] font-medium text-amber-800">{concept.readiness[locale].browsable ? (locale === "cn" ? "可浏览" : "Browsable") : (locale === "cn" ? "草稿" : "Draft")}</span></div><h2 className="truncate text-lg font-semibold">{concept.locales[locale].name || concept.id}</h2><p className="mt-1 line-clamp-2 min-h-10 text-sm text-slate-500">{concept.locales[locale].description || (locale === "cn" ? "当前语言内容待补" : "Content pending in this language")}</p><div className="mt-4 flex items-center justify-between border-t border-slate-100 pt-3 text-xs text-slate-400"><span>{concept.id}</span><span>v{concept.version}</span></div></button>)}</div>}
      {selected && <section className="mt-8 rounded-2xl border border-slate-200 bg-white p-6"><div className="flex flex-wrap items-start justify-between gap-4"><div><p className="text-xs font-medium uppercase tracking-wider text-emerald-800">{selected.id} · v{selected.version}</p><h2 className="mt-2 text-xl font-semibold">{selected.locales[locale].name || selected.id}</h2></div><div className="flex gap-2"><button onClick={() => refresh().catch((cause) => setError(cause.message))} aria-label="Reload" className="rounded-lg border border-slate-200 p-2.5 hover:bg-slate-50"><RefreshCw size={15} /></button><button onClick={() => begin(selected)} className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm hover:bg-slate-50"><Pencil size={14} />{locale === "cn" ? "继续编辑" : "Continue editing"}</button></div></div><p className="mt-5 whitespace-pre-wrap text-sm text-slate-600">{selected.locales[locale].description || (locale === "cn" ? "尚无描述" : "No description yet")}</p><div className="mt-5 border-t border-slate-100 pt-4"><h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500">{locale === "cn" ? "修订" : "Revisions"}</h3><ul className="mt-2 space-y-1 text-xs text-slate-500">{revisions.map((revision) => <li key={revision.version_after}>v{revision.version_after} · {new Date(revision.changed_at).toLocaleString()} · {revision.changes.map((change) => change.path).join(", ")}</li>)}</ul></div></section>}
    </main>
    {editor && <div className="fixed inset-0 z-30 flex items-center justify-center bg-slate-950/40 p-3" onMouseDown={(event) => { if (event.target === event.currentTarget) setEditor(null); }}><form onSubmit={save} className="flex max-h-[94vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl"><div className="flex items-center justify-between border-b border-slate-200 px-6 py-5"><div><p className="text-xs font-medium text-emerald-800">{editor === "create" ? "New record" : `${editor.id} · v${editor.version}`}</p><h2 className="mt-1 text-xl font-semibold">{locale === "cn" ? "Concept 草稿" : "Concept draft"}</h2></div><button type="button" onClick={() => setEditor(null)} aria-label="Close" className="rounded-lg p-2 hover:bg-slate-100"><X size={18} /></button></div><div className="grid gap-5 overflow-y-auto p-6 md:grid-cols-2"><label className="block text-xs font-medium text-slate-600 md:col-span-2">ID · immutable slug<input value={draft.id} disabled={editor !== "create"} onChange={(event) => setField("id", event.target.value)} required className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm disabled:bg-slate-100" placeholder="first-principles" /></label>{(["cn", "en"] as const).map((language) => <section key={language} className="space-y-4 rounded-xl border border-slate-200 p-4"><h3 className="font-semibold">{language === "cn" ? "中文" : "English"}</h3><label className="block text-xs font-medium text-slate-600">Name<input value={language === "cn" ? draft.cnName : draft.enName} onChange={(event) => setField(language === "cn" ? "cnName" : "enName", event.target.value)} className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm" /></label><label className="block text-xs font-medium text-slate-600">Description<textarea value={language === "cn" ? draft.cnDescription : draft.enDescription} onChange={(event) => setField(language === "cn" ? "cnDescription" : "enDescription", event.target.value)} rows={3} className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm" /></label><label className="block text-xs font-medium text-slate-600">Source text<textarea value={language === "cn" ? draft.cnSource : draft.enSource} onChange={(event) => setField(language === "cn" ? "cnSource" : "enSource", event.target.value)} rows={2} className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm" /></label></section>)}<div className="grid gap-4 md:col-span-2 md:grid-cols-2"><label className="text-xs font-medium text-slate-600">Interaction type<select value={draft.interactionType} onChange={(event) => setField("interactionType", event.target.value)} className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm"><option value="">Unspecified</option><option value="operator">Operator</option><option value="lens">Lens</option><option value="procedure">Procedure</option></select></label><label className="text-xs font-medium text-slate-600">Epistemic type<select value={draft.epistemicType} onChange={(event) => setField("epistemicType", event.target.value)} className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm"><option value="">Unspecified</option>{["formal_model", "empirical_finding", "heuristic", "principle", "framework", "law", "bias"].map((value) => <option key={value} value={value}>{value.replaceAll("_", " ")}</option>)}</select></label><label className="text-xs font-medium text-slate-600">Domains<select multiple value={draft.domains} onChange={(event) => setField("domains", [...event.target.selectedOptions].map((option) => option.value))} className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"><option value="reasoning">Reasoning</option><option value="communication">Communication</option></select></label><label className="text-xs font-medium text-slate-600">Intents<select multiple value={draft.intents} onChange={(event) => setField("intents", [...event.target.selectedOptions].map((option) => option.value))} className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"><option value="simplify">Simplify</option><option value="reduce-complexity">Reduce complexity</option></select></label></div></div>{error && <p role="alert" className="mx-6 mb-3 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-800">{error}</p>}<div className="flex justify-end gap-2 border-t border-slate-200 bg-slate-50 px-6 py-4"><button type="button" onClick={() => setEditor(null)} className="rounded-lg px-4 py-2 text-sm text-slate-600 hover:bg-slate-100">Cancel</button><button type="submit" disabled={busy} className="inline-flex items-center gap-2 rounded-lg bg-emerald-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"><Check size={15} />{busy ? "Saving…" : "Save draft"}</button></div></form></div>}
  </div>;
}

export default App;
