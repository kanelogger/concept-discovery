import { useEffect, useState } from "react";
import { BookOpen, Check, Compass, Grid2X2, List, Pencil, Plus, RefreshCw, Search, X } from "lucide-react";

type Locale = "cn" | "en";
type LocaleData = {
  name: string; aliases: string[]; description: string; cover_image: string; wiki_url: string;
  tags: string[]; trigger: string[]; avoid_when: string[]; transform: string[];
  agent_instruction: string; source_text: string;
};
type Readiness = { browsable: boolean; recommendable: boolean; browse_missing: string[]; recommend_missing: string[] };
type Concept = {
  id: string; lifecycle_status: "active" | "archived"; interaction_type: string | null;
  epistemic_type: string | null; domains: string[]; intents: string[];
  locales: Record<Locale, LocaleData>; version: number; created_at: string; updated_at: string;
  readiness: Record<Locale, Readiness>;
};
type Draft = {
  id: string; cnName: string; enName: string; cnAliases: string; enAliases: string;
  cnDescription: string; enDescription: string; cnSource: string; enSource: string;
  cnTags: string; enTags: string; cnWiki: string; enWiki: string;
  cnTrigger: string; enTrigger: string; cnAvoid: string; enAvoid: string;
  cnTransform: string; enTransform: string; cnInstruction: string; enInstruction: string;
  interactionType: string; epistemicType: string;
  domains: string[]; intents: string[];
};
type Revision = { revision_id: number; version_before: number; version_after: number; operation: string; actor: string; changed_at: string; changes: { path: string; before: unknown; after: unknown }[] };
type MediaDraft = { action: "set"; data: string; preview: string; fileName: string } | { action: "remove" } | null;

const blank: Draft = {
  id: "", cnName: "", enName: "", cnAliases: "", enAliases: "", cnDescription: "", enDescription: "",
  cnSource: "", enSource: "", cnTags: "", enTags: "", cnWiki: "", enWiki: "",
  cnTrigger: "", enTrigger: "", cnAvoid: "", enAvoid: "", cnTransform: "", enTransform: "",
  cnInstruction: "", enInstruction: "", interactionType: "", epistemicType: "",
  domains: [], intents: [],
};
const splitList = (value: string) => [...new Set(value.split(",").map((part) => part.trim()).filter(Boolean))];
const formValues = (draft: Draft): Record<string, unknown> => ({
  "locales.cn.name": draft.cnName, "locales.en.name": draft.enName,
  "locales.cn.aliases": splitList(draft.cnAliases), "locales.en.aliases": splitList(draft.enAliases),
  "locales.cn.description": draft.cnDescription, "locales.en.description": draft.enDescription,
  "locales.cn.source_text": draft.cnSource, "locales.en.source_text": draft.enSource,
  "locales.cn.tags": splitList(draft.cnTags), "locales.en.tags": splitList(draft.enTags),
  "locales.cn.wiki_url": draft.cnWiki, "locales.en.wiki_url": draft.enWiki,
  "locales.cn.trigger": splitList(draft.cnTrigger), "locales.en.trigger": splitList(draft.enTrigger),
  "locales.cn.avoid_when": splitList(draft.cnAvoid), "locales.en.avoid_when": splitList(draft.enAvoid),
  "locales.cn.transform": splitList(draft.cnTransform), "locales.en.transform": splitList(draft.enTransform),
  "locales.cn.agent_instruction": draft.cnInstruction, "locales.en.agent_instruction": draft.enInstruction,
  interaction_type: draft.interactionType || null, epistemic_type: draft.epistemicType || null,
  domains: draft.domains, intents: draft.intents,
});
const fromConcept = (concept: Concept): Draft => ({
  id: concept.id,
  cnName: concept.locales.cn.name, enName: concept.locales.en.name,
  cnAliases: concept.locales.cn.aliases.join(", "), enAliases: concept.locales.en.aliases.join(", "),
  cnDescription: concept.locales.cn.description, enDescription: concept.locales.en.description,
  cnSource: concept.locales.cn.source_text, enSource: concept.locales.en.source_text,
  cnTags: concept.locales.cn.tags.join(", "), enTags: concept.locales.en.tags.join(", "),
  cnWiki: concept.locales.cn.wiki_url, enWiki: concept.locales.en.wiki_url,
  cnTrigger: concept.locales.cn.trigger.join(", "), enTrigger: concept.locales.en.trigger.join(", "),
  cnAvoid: concept.locales.cn.avoid_when.join(", "), enAvoid: concept.locales.en.avoid_when.join(", "),
  cnTransform: concept.locales.cn.transform.join(", "), enTransform: concept.locales.en.transform.join(", "),
  cnInstruction: concept.locales.cn.agent_instruction, enInstruction: concept.locales.en.agent_instruction,
  interactionType: concept.interaction_type ?? "", epistemicType: concept.epistemic_type ?? "",
  domains: concept.domains, intents: concept.intents,
});

function updatePayload(concept: Concept, draft: Draft, media: Record<Locale, MediaDraft>) {
  const values = formValues(draft);
  const previous = formValues(fromConcept(concept));
  const changes = Object.fromEntries(Object.entries(values).filter(([path, value]) => JSON.stringify(value) !== JSON.stringify(previous[path])));
  const mediaChanges = Object.fromEntries(((["cn", "en"] as const).filter((language) => media[language]).map((language) => {
    const action = media[language]!;
    return [language, action.action === "set" ? { action: "set", data: action.data } : { action: "remove" }];
  })));
  return { expected_version: concept.version, changes, media: mediaChanges };
}

function createPayload(draft: Draft, preview = false) {
  const values = formValues(draft);
  const localeValues = (language: Locale) => Object.fromEntries(Object.entries(values).filter(([path]) => path.startsWith(`locales.${language}.`)).map(([path, value]) => [path.slice(11), value]));
  return { id: preview && !draft.id ? "preview-draft" : draft.id, interaction_type: values.interaction_type, epistemic_type: values.epistemic_type, domains: values.domains, intents: values.intents, locales: { cn: localeValues("cn"), en: localeValues("en") } };
}

class ApiError extends Error {
  constructor(message: string, readonly code: string, readonly status: number) { super(message); }
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, { ...init, headers: { "Content-Type": "application/json", ...init?.headers } });
  const payload = await response.json();
  if (!response.ok) throw new ApiError(payload.message || "Request failed", payload.error || "request_failed", response.status);
  return payload as T;
}

const words = {
  cn: { library: "Concept 库", manage: "管理视图", title: "发现你的 Concept", subtitle: "按当前语言浏览已齐备的内容。", manageTitle: "管理 Concept", manageSubtitle: "继续补齐草稿与另一种语言的内容。", create: "新建 Concept", search: "搜索名称、别名、描述或标签", all: "全部状态", draft: "草稿", browsable: "可浏览", recommended: "可推荐", tag: "标签", domain: "领域", result: "条结果", empty: "当前没有符合条件的 Concept", edit: "继续编辑", source: "出处", missing: "待补字段", noImage: "暂无图片" },
  en: { library: "Concept Library", manage: "Manage", title: "Explore your Concepts", subtitle: "Browse content ready in this language.", manageTitle: "Manage Concepts", manageSubtitle: "Complete drafts and the other language independently.", create: "New Concept", search: "Search name, aliases, description or tags", all: "All statuses", draft: "Draft", browsable: "Browsable", recommended: "Recommendable", tag: "Tag", domain: "Domain", result: "results", empty: "No Concepts match these filters", edit: "Continue editing", source: "Source", missing: "Missing fields", noImage: "No image" },
};

function App() {
  const [locale, setLocale] = useState<Locale>("cn");
  const [section, setSection] = useState<"browse" | "manage">("browse");
  const [density, setDensity] = useState<"cards" | "table">("cards");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [tag, setTag] = useState("");
  const [domain, setDomain] = useState("");
  const [concepts, setConcepts] = useState<Concept[]>([]);
  const [count, setCount] = useState(0);
  const [selected, setSelected] = useState<Concept | null>(null);
  const [revisions, setRevisions] = useState<Revision[]>([]);
  const [editor, setEditor] = useState<Concept | "create" | null>(null);
  const [draft, setDraft] = useState<Draft>(blank);
  const [media, setMedia] = useState<Record<Locale, MediaDraft>>({ cn: null, en: null });
  const [preview, setPreview] = useState<Record<Locale, Readiness> | null>(null);
  const [error, setError] = useState("");
  const [conflict, setConflict] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);
  const t = words[locale];

  useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      const params = new URLSearchParams({ locale, view: section, q: search, status, tag, domain });
      try {
        const result = await api<{ count: number; concepts: Concept[] }>(`/api/concepts?${params}`);
        if (!cancelled) {
          setConcepts(result.concepts); setCount(result.count); setLoading(false); setError("");
          setSelected((current) => current ? result.concepts.find((concept) => concept.id === current.id) ?? null : null);
        }
      } catch (cause) { if (!cancelled) { setError(cause instanceof Error ? cause.message : "Load failed"); setLoading(false); } }
    }, 120);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [locale, section, search, status, tag, domain, refreshKey]);
  useEffect(() => {
    if (!selected) { setRevisions([]); return; }
    api<{ revisions: Revision[] }>(`/api/concepts/${encodeURIComponent(selected.id)}/revisions`)
      .then((result) => setRevisions(result.revisions)).catch(() => setRevisions([]));
  }, [selected?.id, selected?.version]);
  useEffect(() => {
    if (!editor) return;
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      try {
        if (editor === "create") {
          const result = await api<{ readiness: Record<Locale, Readiness> }>("/api/concepts/preview", { method: "POST", body: JSON.stringify(createPayload(draft, true)) });
          if (!cancelled) setPreview(result.readiness);
        } else {
          const result = await api<{ after: Record<Locale, Readiness> }>(`/api/concepts/${encodeURIComponent(editor.id)}/preview`, { method: "POST", body: JSON.stringify(updatePayload(editor, draft, media)) });
          if (!cancelled) setPreview(result.after);
        }
      } catch (cause) {
        if (!cancelled) {
          setPreview(null);
          if (cause instanceof ApiError && cause.code === "version_conflict") setConflict(true);
        }
      }
    }, 180);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [editor, draft, media]);

  const begin = (concept?: Concept) => {
    setError(""); setConflict(false); setEditor(concept ?? "create"); setDraft(concept ? fromConcept(concept) : { ...blank }); setMedia({ cn: null, en: null }); setPreview(concept?.readiness ?? null);
  };
  const reloadEditor = async () => {
    if (!editor || editor === "create") return;
    try {
      const latest = await api<Concept>(`/api/concepts/${encodeURIComponent(editor.id)}`);
      setEditor(latest); setSelected(latest); setDraft(fromConcept(latest)); setMedia({ cn: null, en: null }); setPreview(latest.readiness); setConflict(false); setError("");
      setRefreshKey((key) => key + 1);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Reload failed"); }
  };
  const setField = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft((current) => ({ ...current, [key]: value }));
  const chooseImage = (language: Locale, file?: File) => {
    if (!file) return;
    if (file.type !== "image/webp") { setError("Choose a WebP image / 请选择 WebP 图片"); return; }
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result !== "string" || !reader.result.includes(",")) { setError("Could not read image"); return; }
      setMedia((current) => ({ ...current, [language]: { action: "set", data: reader.result!.toString().split(",")[1], preview: reader.result!.toString(), fileName: file.name } }));
      setError("");
    };
    reader.onerror = () => setError("Could not read image");
    reader.readAsDataURL(file);
  };
  const save = async (event: React.FormEvent) => {
    event.preventDefault(); setBusy(true); setError("");
    try {
      let saved: Concept;
      if (editor === "create") {
        saved = await api<Concept>("/api/concepts", { method: "POST", body: JSON.stringify(createPayload(draft)) });
      } else if (editor) {
        const payload = updatePayload(editor, draft, media);
        const impact = await api<{ before: Record<Locale, Readiness>; after: Record<Locale, Readiness> }>(`/api/concepts/${encodeURIComponent(editor.id)}/preview`, { method: "POST", body: JSON.stringify(payload) });
        const exits: string[] = [];
        for (const language of ["cn", "en"] as const) {
          if (impact.before[language].recommendable && !impact.after[language].recommendable) exits.push(`${language}: ${locale === "cn" ? "退出推荐池" : "leaves recommendations"}`);
          if (impact.before[language].browsable && !impact.after[language].browsable) exits.push(`${language}: ${locale === "cn" ? "退出浏览和搜索" : "leaves browse and search"}`);
        }
        if (exits.length && !window.confirm(`${locale === "cn" ? "保存会降低语言资格：" : "Saving will lower locale readiness:"}\n${exits.join("\n")}\n${locale === "cn" ? "仍要保存吗？" : "Save anyway?"}`)) return;
        saved = await api<Concept>(`/api/concepts/${encodeURIComponent(editor.id)}`, { method: "PATCH", body: JSON.stringify(payload) });
      } else return;
      setSelected(saved); setEditor(null); setSearch(""); setTag(""); setDomain(""); setStatus("all");
      if (!saved.readiness[locale].browsable) setSection("manage");
      setRefreshKey((current) => current + 1);
    } catch (cause) {
      if (cause instanceof ApiError && cause.code === "version_conflict") setConflict(true);
      setError(cause instanceof Error ? cause.message : "Save failed");
    }
    finally { setBusy(false); }
  };
  const changeSection = (next: "browse" | "manage") => { setSection(next); setStatus("all"); setSearch(""); setTag(""); setDomain(""); setSelected(null); };

  return <div className="min-h-screen bg-[#f7f8f5] text-slate-900">
    <header className="sticky top-0 z-30 flex h-16 items-center justify-between border-b border-slate-200 bg-white/95 px-5 backdrop-blur md:px-10">
      <div className="flex items-center gap-3"><div className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-900 text-white"><Compass size={19} /></div><div><div className="text-sm font-semibold">Concept Discovery</div><div className="text-[11px] text-slate-500">Local Registry</div></div></div>
      <div className="flex items-center gap-2"><button type="button" onClick={() => { setLocale("cn"); setSelected(null); }} aria-pressed={locale === "cn"} className={`rounded-lg px-3 py-2 text-xs ${locale === "cn" ? "bg-emerald-900 text-white" : "text-slate-500 hover:bg-slate-100"}`}>中文</button><button type="button" onClick={() => { setLocale("en"); setSelected(null); }} aria-pressed={locale === "en"} className={`rounded-lg px-3 py-2 text-xs ${locale === "en" ? "bg-emerald-900 text-white" : "text-slate-500 hover:bg-slate-100"}`}>English</button></div>
    </header>
    <main className="mx-auto max-w-6xl px-5 pb-16 md:px-10">
      <div className="flex gap-1 border-b border-slate-200 pt-5"><button onClick={() => changeSection("browse")} className={`border-b-2 px-4 py-3 text-sm ${section === "browse" ? "border-emerald-800 font-semibold text-emerald-900" : "border-transparent text-slate-500"}`}>{t.library}</button><button onClick={() => changeSection("manage")} className={`border-b-2 px-4 py-3 text-sm ${section === "manage" ? "border-emerald-800 font-semibold text-emerald-900" : "border-transparent text-slate-500"}`}>{t.manage}</button></div>
      <div className="flex flex-wrap items-end justify-between gap-4 py-8"><div><p className="mb-2 text-[11px] font-semibold uppercase tracking-[.18em] text-emerald-800">Concept Registry</p><h1 className="text-3xl font-semibold tracking-tight">{section === "browse" ? t.title : t.manageTitle}</h1><p className="mt-2 text-sm text-slate-500">{section === "browse" ? t.subtitle : t.manageSubtitle}</p></div><button onClick={() => begin()} className="inline-flex items-center gap-2 rounded-xl bg-emerald-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-emerald-800"><Plus size={16} />{t.create}</button></div>
      <div className="sticky top-16 z-20 mb-5 flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-white/95 p-3 shadow-sm backdrop-blur"><label className="relative min-w-48 flex-1"><Search size={15} className="absolute left-3 top-3 text-slate-400" /><input value={search} onChange={(event) => setSearch(event.target.value)} aria-label={t.search} placeholder={t.search} className="w-full rounded-lg border border-slate-200 py-2 pl-9 pr-3 text-sm outline-none focus:border-emerald-700" /></label>{section === "manage" && <select value={status} onChange={(event) => setStatus(event.target.value)} aria-label="Status" className="rounded-lg border border-slate-200 px-3 py-2 text-sm"><option value="all">{t.all}</option><option value="draft">{t.draft}</option><option value="browsable">{t.browsable}</option><option value="recommendable">{t.recommended}</option></select>}<input value={tag} onChange={(event) => setTag(event.target.value)} aria-label={t.tag} placeholder={t.tag} className="w-28 rounded-lg border border-slate-200 px-3 py-2 text-sm" /><select value={domain} onChange={(event) => setDomain(event.target.value)} aria-label={t.domain} className="rounded-lg border border-slate-200 px-3 py-2 text-sm"><option value="">{t.domain}</option><option value="reasoning">Reasoning</option><option value="communication">Communication</option></select><div className="ml-auto flex rounded-lg border border-slate-200 p-0.5"><button onClick={() => setDensity("cards")} aria-label="Card view" aria-pressed={density === "cards"} className={`rounded-md p-2 ${density === "cards" ? "bg-emerald-50 text-emerald-900" : "text-slate-400"}`}><Grid2X2 size={16} /></button><button onClick={() => setDensity("table")} aria-label="Table view" aria-pressed={density === "table"} className={`rounded-md p-2 ${density === "table" ? "bg-emerald-50 text-emerald-900" : "text-slate-400"}`}><List size={16} /></button></div></div>
      <div className="mb-4 text-xs text-slate-500">{count} {t.result}</div>
      {error && !editor && <p role="alert" className="mb-5 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">{error}</p>}
      {loading ? <p className="text-sm text-slate-500">Loading…</p> : concepts.length === 0 ? <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-6 py-20 text-center"><BookOpen className="mx-auto mb-4 text-emerald-800" size={28} /><h2 className="font-medium">{t.empty}</h2></div> : density === "cards" ? <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">{concepts.map((concept) => <ConceptCard key={concept.id} concept={concept} locale={locale} manage={section === "manage"} selected={selected?.id === concept.id} onSelect={() => setSelected(concept)} />)}</div> : <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white"><table className="w-full min-w-[650px] text-left text-sm"><thead className="bg-slate-50 text-xs text-slate-500"><tr><th className="px-4 py-3">Concept</th><th className="px-4 py-3">{t.tag}</th><th className="px-4 py-3">Status</th><th className="px-4 py-3">Version</th></tr></thead><tbody>{concepts.map((concept) => <tr key={concept.id} className="border-t border-slate-100"><td className="px-4 py-3"><button onClick={() => setSelected(concept)} className="text-left font-medium text-emerald-900 hover:underline">{concept.locales[locale].name || concept.id}</button><div className="max-w-sm truncate text-xs text-slate-500">{concept.locales[locale].description}</div></td><td className="px-4 py-3 text-slate-500">{concept.locales[locale].tags.join(", ")}</td><td className="px-4 py-3 text-slate-500">{concept.readiness[locale].recommendable ? t.recommended : concept.readiness[locale].browsable ? t.browsable : t.draft}</td><td className="px-4 py-3 text-slate-500">v{concept.version}</td></tr>)}</tbody></table></div>}
      {selected && <section className="mt-8 rounded-2xl border border-slate-200 bg-white p-6"><div className="flex flex-wrap items-start justify-between gap-4"><div><p className="text-xs font-medium uppercase tracking-wider text-emerald-800">{selected.id} · v{selected.version}</p><h2 className="mt-2 text-xl font-semibold">{selected.locales[locale].name || selected.id}</h2></div><div className="flex gap-2"><button onClick={() => setRefreshKey((key) => key + 1)} aria-label="Reload" className="rounded-lg border border-slate-200 p-2.5 hover:bg-slate-50"><RefreshCw size={15} /></button><button onClick={() => begin(selected)} className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm hover:bg-slate-50"><Pencil size={14} />{t.edit}</button></div></div>{selected.locales[locale].cover_image && <img src={"/api/assets/" + selected.locales[locale].cover_image} alt="" className="mt-5 h-48 w-full rounded-xl object-cover" />}<p className="mt-5 whitespace-pre-wrap text-sm text-slate-600">{selected.locales[locale].description || "—"}</p>{selected.locales[locale].tags.length > 0 && <div className="mt-4 flex flex-wrap gap-1.5">{selected.locales[locale].tags.map((value) => <span key={value} className="rounded-full bg-slate-100 px-2.5 py-1 text-xs text-slate-600">{value}</span>)}</div>}<div className="mt-5 border-t border-slate-100 pt-4"><h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500">{t.source}</h3><p className="mt-2 whitespace-pre-wrap text-sm text-slate-600">{selected.locales[locale].source_text || "—"}</p>{selected.locales[locale].wiki_url && <a href={selected.locales[locale].wiki_url} target="_blank" rel="noopener noreferrer" className="mt-3 inline-block text-sm text-emerald-800 underline">Wiki ↗</a>}{section === "manage" && !selected.readiness[locale].browsable && <p className="mt-3 text-xs text-amber-800">{t.missing}: {selected.readiness[locale].browse_missing.join(", ")}</p>}</div><RevisionHistory revisions={revisions} locale={locale} /></section>}
    </main>
    {editor && <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-950/40 p-3" onMouseDown={(event) => { if (event.target === event.currentTarget) setEditor(null); }}><form onSubmit={save} className="flex max-h-[94vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl"><div className="flex items-center justify-between border-b border-slate-200 px-6 py-5"><div><p className="text-xs font-medium text-emerald-800">{editor === "create" ? "New record" : `${editor.id} · v${editor.version}`}</p><h2 className="mt-1 text-xl font-semibold">Concept</h2></div><button type="button" onClick={() => setEditor(null)} aria-label="Close" className="rounded-lg p-2 hover:bg-slate-100"><X size={18} /></button></div><div className="grid gap-5 overflow-y-auto p-6 md:grid-cols-2"><label className="block text-xs font-medium text-slate-600 md:col-span-2">ID · immutable slug<input value={draft.id} disabled={editor !== "create"} onChange={(event) => setField("id", event.target.value)} required className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm disabled:bg-slate-100" placeholder="first-principles" /></label>{(["cn", "en"] as const).map((language) => <LanguageForm key={language} language={language} draft={draft} setField={setField} existingImage={editor !== "create" ? editor.locales[language].cover_image : ""} media={media[language]} canUpload={editor !== "create"} onChooseImage={(file) => chooseImage(language, file)} onRemoveImage={() => setMedia((current) => ({ ...current, [language]: { action: "remove" } }))} readiness={preview?.[language] ?? (editor !== "create" ? editor.readiness[language] : null)} />)}<div className="grid gap-4 md:col-span-2 md:grid-cols-2"><label className="text-xs font-medium text-slate-600">Interaction type<select value={draft.interactionType} onChange={(event) => setField("interactionType", event.target.value)} className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm"><option value="">Unspecified</option><option value="operator">Operator</option><option value="lens">Lens</option><option value="procedure">Procedure</option></select></label><label className="text-xs font-medium text-slate-600">Epistemic type<select value={draft.epistemicType} onChange={(event) => setField("epistemicType", event.target.value)} className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm"><option value="">Unspecified</option>{["formal_model", "empirical_finding", "heuristic", "principle", "framework", "law", "bias"].map((value) => <option key={value} value={value}>{value.replaceAll("_", " ")}</option>)}</select></label><label className="text-xs font-medium text-slate-600">Domains<select multiple value={draft.domains} onChange={(event) => setField("domains", [...event.target.selectedOptions].map((option) => option.value))} className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"><option value="reasoning">Reasoning</option><option value="communication">Communication</option></select></label><label className="text-xs font-medium text-slate-600">Intents<select multiple value={draft.intents} onChange={(event) => setField("intents", [...event.target.selectedOptions].map((option) => option.value))} className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"><option value="simplify">Simplify</option><option value="reduce-complexity">Reduce complexity</option></select></label></div></div>{(error || conflict) && <div role="alert" className="mx-6 mb-3 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-800"><p>{conflict ? (locale === "cn" ? "此 Concept 已在另一会话更新。重新载入最新版本后再编辑。" : "This Concept changed in another session. Reload the latest version before editing.") : error}</p>{conflict && <button type="button" onClick={reloadEditor} className="mt-2 rounded-md border border-rose-300 bg-white px-3 py-1.5 font-medium">{locale === "cn" ? "重新载入最新版本（放弃未保存修改）" : "Reload latest (discard unsaved edits)"}</button>}</div>}<div className="flex justify-end gap-2 border-t border-slate-200 bg-slate-50 px-6 py-4"><button type="button" onClick={() => setEditor(null)} className="rounded-lg px-4 py-2 text-sm text-slate-600 hover:bg-slate-100">Cancel</button><button type="submit" disabled={busy} className="inline-flex items-center gap-2 rounded-lg bg-emerald-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"><Check size={15} />{busy ? "Saving…" : "Save"}</button></div></form></div>}
  </div>;
}

function ConceptCard({ concept, locale, manage, selected, onSelect }: { concept: Concept; locale: Locale; manage: boolean; selected: boolean; onSelect: () => void }) {
  const local = concept.locales[locale];
  const ready = concept.readiness[locale];
  return <button onClick={onSelect} className={`overflow-hidden rounded-2xl border bg-white text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-md ${selected ? "border-emerald-800" : "border-slate-200"}`}><div className="flex h-36 items-center justify-center bg-gradient-to-br from-emerald-50 to-slate-100 text-emerald-700">{local.cover_image ? <img src={"/api/assets/" + local.cover_image} alt="" className="h-full w-full object-cover" /> : <BookOpen size={28} />}</div><div className="p-5"><div className="mb-3 flex justify-between gap-2"><span className="rounded-full bg-amber-50 px-2.5 py-1 text-[11px] font-medium text-amber-800">{ready.recommendable ? (locale === "cn" ? "可推荐" : "Recommendable") : ready.browsable ? (locale === "cn" ? "可浏览" : "Browsable") : (locale === "cn" ? "草稿" : "Draft")}</span><span className="text-xs text-slate-400">v{concept.version}</span></div><h2 className="truncate text-lg font-semibold">{local.name || concept.id}</h2><p className="mt-1 line-clamp-2 min-h-10 text-sm text-slate-500">{local.description || (locale === "cn" ? "当前语言内容待补" : "Content pending in this language")}</p>{local.tags.length > 0 && <p className="mt-3 truncate text-xs text-emerald-800">{local.tags.join(" · ")}</p>}{manage && !ready.browsable && <p className="mt-3 text-xs text-amber-800">{ready.browse_missing.join(", ")}</p>}<div className="mt-4 border-t border-slate-100 pt-3 text-xs text-slate-400">{concept.id}</div></div></button>;
}

function RevisionValue({ value, image, locale }: { value: unknown; image: boolean; locale: Locale }) {
  if (value === null || value === undefined || value === "" || (Array.isArray(value) && value.length === 0)) return <span className="text-slate-400">∅</span>;
  if (image && typeof value === "string" && /^[a-f0-9]{64}$/.test(value)) {
    return <a href={`/api/assets/${value}`} target="_blank" rel="noopener noreferrer" title={value} className="font-mono text-emerald-800 underline">{value.slice(0, 12)}… {locale === "cn" ? "查看图片" : "View image"}</a>;
  }
  return <span className="break-words whitespace-pre-wrap">{typeof value === "string" ? value : JSON.stringify(value)}</span>;
}

function RevisionHistory({ revisions, locale }: { revisions: Revision[]; locale: Locale }) {
  return <section className="mt-5 border-t border-slate-100 pt-4" aria-label={locale === "cn" ? "修订历史" : "Revision history"}>
    <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500">{locale === "cn" ? "修订历史" : "Revision history"}</h3>
    {revisions.length === 0 ? <p className="mt-2 text-xs text-slate-500">{locale === "cn" ? "暂无修订" : "No revisions"}</p> : <div className="mt-3 space-y-2">{revisions.map((revision) => <details key={revision.revision_id} className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs" open={revision.version_after === revisions[0].version_after}>
      <summary className="cursor-pointer font-medium text-slate-700">v{revision.version_after} · {revision.operation === "create" ? (locale === "cn" ? "创建" : "Created") : (locale === "cn" ? "更新" : "Updated")} · <time dateTime={revision.changed_at}>{new Date(revision.changed_at).toLocaleString()}</time> · {revision.actor} · {revision.changes.length} {locale === "cn" ? "处变更" : "changes"}</summary>
      <ul className="mt-3 space-y-2 border-t border-slate-200 pt-3">{revision.changes.map((change) => <li key={change.path} className="rounded-md bg-white p-2"><div className="font-mono font-medium text-slate-700">{change.path}</div><div className="mt-1 grid gap-1 text-slate-600 sm:grid-cols-2"><div><span className="text-slate-400">{locale === "cn" ? "原值" : "Before"}: </span><RevisionValue value={change.before} image={change.path.endsWith(".cover_image")} locale={locale} /></div><div><span className="text-slate-400">{locale === "cn" ? "新值" : "After"}: </span><RevisionValue value={change.after} image={change.path.endsWith(".cover_image")} locale={locale} /></div></div></li>)}</ul>
    </details>)}</div>}
  </section>;
}

function LanguageForm({ language, draft, setField, existingImage, media, canUpload, onChooseImage, onRemoveImage, readiness }: {
  language: Locale; draft: Draft; setField: <K extends keyof Draft>(key: K, value: Draft[K]) => void;
  existingImage: string; media: MediaDraft; canUpload: boolean;
  onChooseImage: (file?: File) => void; onRemoveImage: () => void; readiness: Readiness | null;
}) {
  const prefix = language === "cn" ? "cn" : "en";
  type Suffix = "Name" | "Aliases" | "Description" | "Source" | "Tags" | "Wiki" | "Trigger" | "Avoid" | "Transform" | "Instruction";
  const value = (suffix: Suffix) => draft[`${prefix}${suffix}`];
  const update = (suffix: Suffix, next: string) => setField(`${prefix}${suffix}`, next);
  const image = media?.action === "set" ? media.preview : media?.action === "remove" ? "" : existingImage ? `/api/assets/${existingImage}` : "";
  return <section className="space-y-4 rounded-xl border border-slate-200 p-4">
    <h3 className="font-semibold">{language === "cn" ? "中文" : "English"}</h3>
    {readiness ? <div className="rounded-lg bg-emerald-50 px-3 py-2 text-[11px] text-emerald-950"><strong>{readiness.recommendable ? "Recommendable" : readiness.browsable ? "Browsable" : "Draft"}</strong><p className="mt-1">Browse missing: {readiness.browse_missing.join(", ") || "none"}</p><p>Recommend missing: {readiness.recommend_missing.join(", ") || "none"}</p></div> : <p className="text-[11px] text-slate-500">Save to calculate exact language readiness.</p>}
    <label className="block text-xs font-medium text-slate-600">Name<input value={value("Name")} onChange={(event) => update("Name", event.target.value)} className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm" /></label>
    <label className="block text-xs font-medium text-slate-600">Aliases · comma separated<input value={value("Aliases")} onChange={(event) => update("Aliases", event.target.value)} className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm" /></label>
    <label className="block text-xs font-medium text-slate-600">Description<textarea value={value("Description")} onChange={(event) => update("Description", event.target.value)} rows={3} className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm" /></label>
    <label className="block text-xs font-medium text-slate-600">Source text<textarea value={value("Source")} onChange={(event) => update("Source", event.target.value)} rows={2} className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm" /></label>
    <label className="block text-xs font-medium text-slate-600">Tags · comma separated<input value={value("Tags")} onChange={(event) => update("Tags", event.target.value)} className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm" /></label>
    <label className="block text-xs font-medium text-slate-600">Wiki URL · optional<input type="url" value={value("Wiki")} onChange={(event) => update("Wiki", event.target.value)} placeholder="https://…" className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm" /></label>
    <label className="block text-xs font-medium text-slate-600">Trigger scenarios · comma separated<input value={value("Trigger")} onChange={(event) => update("Trigger", event.target.value)} className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm" /></label>
    <label className="block text-xs font-medium text-slate-600">Avoid when · comma separated<input value={value("Avoid")} onChange={(event) => update("Avoid", event.target.value)} className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm" /></label>
    <label className="block text-xs font-medium text-slate-600">Transform goals · comma separated<input value={value("Transform")} onChange={(event) => update("Transform", event.target.value)} className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm" /></label>
    <label className="block text-xs font-medium text-slate-600">Agent instruction<textarea value={value("Instruction")} onChange={(event) => update("Instruction", event.target.value)} rows={3} className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm" /></label>
    <div className="text-xs font-medium text-slate-600">WebP image <span className="font-normal text-slate-400">· 2 MB target size</span>
      <div className="mt-2 flex items-center gap-3 rounded-lg border border-dashed border-slate-300 bg-slate-50 p-3">
        {image ? <img src={image} alt={language === "cn" ? "中文图片预览" : "English image preview"} className="h-16 w-20 rounded-md object-cover" /> : <div className="flex h-16 w-20 items-center justify-center rounded-md bg-emerald-50 text-emerald-700"><BookOpen size={19} /></div>}
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs text-slate-500">{media?.action === "set" ? media.fileName : image ? "Image ready" : "No image"}</p>
          {canUpload ? <input aria-label={language === "cn" ? "中文 WebP 图片" : "English WebP image"} type="file" accept="image/webp" onChange={(event) => { onChooseImage(event.target.files?.[0]); event.currentTarget.value = ""; }} className="mt-2 block w-full text-[11px] file:mr-2 file:rounded-md file:border-0 file:bg-white file:px-2 file:py-1" /> : <p className="mt-2 text-[11px] text-slate-400">Save the draft before adding an image.</p>}
        </div>
        {canUpload && image && <button type="button" onClick={onRemoveImage} aria-label={language === "cn" ? "移除中文图片" : "Remove English image"} className="rounded-md border border-slate-200 bg-white px-2 py-1.5 text-[11px]">Remove</button>}
      </div>
    </div>
  </section>;
}
export default App;
