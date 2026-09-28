import { useEffect, useState } from "react";
import { BookOpen, Compass, Grid2X2, List, Plus, Search, X } from "lucide-react";
import type { Locale, Concept, Draft, DashboardData, Readiness, MediaDraft, MediaDraftItem } from "./model";
import { blank, fromConcept, storedImages, updatePayload, createPayload } from "./model";
import { api, ApiError } from "./api";
import { words } from "./copy";
import taxonomy from "../../shared/taxonomy.json";
import TaxonomyPicker from "./TaxonomyPicker";
import DashboardView from "./DashboardView";
import ConceptCard from "./ConceptCard";
import ConceptEditor from "./ConceptEditor";
import ConceptDetailModal from "./ConceptDetail";
import Modal from "./Modal";
import RecommendationDrawer from "./RecommendationDrawer";
import type { DiscoveryResult } from "./RecommendationDrawer";
import { useNavigation } from "./useNavigation";
function App() {
  const { navigation, navigate, set: setNavigation } = useNavigation();
  const { locale, section, density, search, status, tag, domain, page, pageSize, concept: selectedId } = navigation;
  const setLocale = (value: Locale) => setNavigation("locale", value);
  const setDensity = (value: "cards" | "table") => setNavigation("density", value);
  const setStatus = (value: string) => setNavigation("status", value);
  const setTag = (value: string) => setNavigation("tag", value);
  const setDomain = (value: string[]) => setNavigation("domain", value);
  const setPage = (value: number | ((page: number) => number)) => setNavigation("page", value);
  const setPageSize = (value: number) => setNavigation("pageSize", value);
  const openConcept = (id: string) => navigate({ concept: id, section: "manage" });
  const closeConcept = () => navigate({ concept: null });
  const [searchInput, setSearchInput] = useState(search);
  const [discoveryRequest, setDiscoveryRequest] = useState<{ id: string; query: string; locale: Locale } | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [discoveryResult, setDiscoveryResult] = useState<DiscoveryResult | null>(null);
  const [discoveryLoading, setDiscoveryLoading] = useState(false);
  const [discoveryError, setDiscoveryError] = useState("");
  useEffect(() => { setSearchInput(search); }, [search]);
  useEffect(() => {
    if (discoveryRequest && (search !== discoveryRequest.query || locale !== discoveryRequest.locale)) setDrawerOpen(false);
  }, [search, locale, discoveryRequest]);
  useEffect(() => {
    if (!drawerOpen || !discoveryRequest) return;
    const controller = new AbortController();
    setDiscoveryResult(null); setDiscoveryError(""); setDiscoveryLoading(true);
    api<DiscoveryResult>("/api/discover", { method: "POST", body: JSON.stringify({ task: discoveryRequest.query, locale: discoveryRequest.locale, limit: 3 }), signal: controller.signal })
      .then((result) => { if (!controller.signal.aborted) setDiscoveryResult(result); })
      .catch((cause) => { if (!controller.signal.aborted) setDiscoveryError(cause instanceof Error ? cause.message : "Discovery failed"); })
      .finally(() => { if (!controller.signal.aborted) setDiscoveryLoading(false); });
    return () => controller.abort();
  }, [drawerOpen, discoveryRequest]);
  const submitSearch = (event: React.FormEvent) => {
    event.preventDefault();
    const query = searchInput.trim();
    setSearchInput(query);
    navigate({ search: query, page: 1 }, "push");
    if (query) { setDiscoveryRequest({ id: crypto.randomUUID(), query, locale }); setDrawerOpen(true); }
    else { setDiscoveryRequest(null); setDrawerOpen(false); }
  };
  const clearSearch = () => {
    setSearchInput(""); setDrawerOpen(false); setDiscoveryRequest(null);
    navigate({ search: "", page: 1 }, "replace");
  };
  const resetSearch = () => {
    setSearchInput(""); setDrawerOpen(false); setDiscoveryRequest(null);
    navigate({ search: "", status: "browsable", tag: "", domain: [], page: 1 }, "replace");
  };
  const [detailError, setDetailError] = useState("");
  const [concepts, setConcepts] = useState<Concept[]>([]);
  const [count, setCount] = useState(0);
  const [selected, setSelected] = useState<Concept | null>(null);
  const [dashboard, setDashboard] = useState<DashboardData | null>(null);
  const [dashboardError, setDashboardError] = useState("");
  const [editor, setEditor] = useState<Concept | "create" | null>(null);
  const [draft, setDraft] = useState<Draft>(blank);
  const [media, setMedia] = useState<Record<Locale, MediaDraft>>({ cn: null, en: null });
  const [preview, setPreview] = useState<Record<Locale, Readiness> | null>(null);
  const [error, setError] = useState("");
  const [conflict, setConflict] = useState(false);
  const [deleteCandidate, setDeleteCandidate] = useState<Concept | null>(null);
  const [deleteText, setDeleteText] = useState("");
  const [deleteError, setDeleteError] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);
  const t = words[locale];
  const pageCount = Math.max(1, Math.ceil(count / pageSize));
  const currentPage = Math.min(page, pageCount);
  const pageConcepts = concepts.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  useEffect(() => {
    setSelected(null); setDetailError("");
    if (!selectedId) return;
    let cancelled = false;
    api<Concept>(`/api/concepts/${encodeURIComponent(selectedId)}`)
      .then((concept) => { if (!cancelled) setSelected(concept); })
      .catch((cause) => { if (!cancelled) setDetailError(cause instanceof Error ? cause.message : "Load failed"); });
    return () => { cancelled = true; };
  }, [selectedId, refreshKey]);
  useEffect(() => {
    if (selectedId || loading) return;
    const frame = requestAnimationFrame(() => window.scrollTo(0, window.history.state?.listScroll ?? 0));
    return () => cancelAnimationFrame(frame);
  }, [selectedId, loading]);

  useEffect(() => {
    if (section === "dashboard") return;
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      const params = new URLSearchParams({ locale, view: section, q: search, status, tag, domain: domain.join(","), include: "relation_preview" });
      try {
        const result = await api<{ count: number; concepts: Concept[] }>(`/api/concepts?${params}`);
        if (!cancelled) {
          setConcepts(result.concepts); setCount(result.count); setLoading(false); setError("");

        }
      } catch (cause) { if (!cancelled) { setError(cause instanceof Error ? cause.message : "Load failed"); setLoading(false); } }
    }, 120);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [locale, section, search, status, tag, domain, refreshKey]);
  useEffect(() => {
    if (section !== "dashboard") return;
    let cancelled = false;
    api<DashboardData>("/api/dashboard").then((result) => { if (!cancelled) { setDashboard(result); setDashboardError(""); } }).catch((cause) => { if (!cancelled) setDashboardError(cause instanceof Error ? cause.message : "Dashboard failed to load"); });
    return () => { cancelled = true; };
  }, [section, refreshKey]);
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
  const dirty = Boolean(editor && (JSON.stringify(draft) !== JSON.stringify(editor === "create" ? blank : fromConcept(editor)) || media.cn !== null || media.en !== null));
  const closeEditor = () => {
    if (busy) return;
    if (dirty && !window.confirm(locale === "cn" ? "放弃未保存的修改？" : "Discard unsaved changes?")) return;
    setEditor(null); setError("");
  };
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  const reloadEditor = async () => {
    if (!editor || editor === "create") return;
    try {
      const latest = await api<Concept>(`/api/concepts/${encodeURIComponent(editor.id)}`);
      setEditor(latest); setSelected(latest); setDraft(fromConcept(latest)); setMedia({ cn: null, en: null }); setPreview(latest.readiness); setConflict(false); setError("");
      setRefreshKey((key) => key + 1);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Reload failed"); }
  };
  const setField = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft((current) => ({ ...current, [key]: value }));
  const chooseImages = async (language: Locale, files?: FileList | File[]) => {
    const selectedFiles = [...(files ?? [])];
    if (!selectedFiles.length) return;
    if (selectedFiles.some((file) => file.type !== "image/webp")) { setError("Choose WebP images / 请选择 WebP 图片"); return; }
    try {
      const additions = await Promise.all(selectedFiles.map((file) => new Promise<MediaDraftItem>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
          if (typeof reader.result !== "string" || !reader.result.includes(",")) return reject(new Error("Could not read image"));
          resolve({ kind: "new", id: crypto.randomUUID(), data: reader.result.split(",")[1], preview: reader.result, fileName: file.name });
        };
        reader.onerror = () => reject(new Error("Could not read image"));
        reader.readAsDataURL(file);
      })));
      setMedia((current) => ({ ...current, [language]: [...(current[language] ?? (editor && editor !== "create" ? storedImages(editor.locales[language]).map((hash) => ({ kind: "existing" as const, hash })) : [])), ...additions] }));
      setError("");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not read image"); }
  };
  const removeImage = (language: Locale, index: number) => {
    setMedia((current) => ({ ...current, [language]: (current[language] ?? (editor && editor !== "create" ? storedImages(editor.locales[language]).map((hash) => ({ kind: "existing" as const, hash })) : [])).filter((_, itemIndex) => itemIndex !== index) }));
  };
  const save = async (event: React.FormEvent) => {
    event.preventDefault(); setBusy(true); setError("");
    try {
      let saved: Concept;
      if (editor === "create") {
        saved = await api<Concept>("/api/concepts", { method: "POST", body: JSON.stringify(createPayload(draft, false, media)) });
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
      setSelected(saved); setEditor(null); openConcept(saved.id);
      setRefreshKey((current) => current + 1);
    } catch (cause) {
      if (cause instanceof ApiError && cause.code === "version_conflict") setConflict(true);
      setError(cause instanceof Error ? cause.message : "Save failed");
    }
    finally { setBusy(false); }
  };
  const changeSection = (next: "manage" | "dashboard") => navigate({ section: next, concept: null });
  const changeLifecycle = async (concept: Concept, next: "archive" | "restore") => {
    if (next === "archive") {
      const impact = (["cn", "en"] as const).map((language) => {
        const ready = concept.readiness[language];
        const label = ready.recommendable ? (locale === "cn" ? "可推荐" : "Recommendable") : ready.browsable ? (locale === "cn" ? "可浏览" : "Browsable") : (locale === "cn" ? "草稿" : "Draft");
        return `${language}: ${label}`;
      }).join("\n");
      const message = locale === "cn"
        ? `删除 ${concept.id}？\n${impact}\n该词条会移入已归档，可从“已归档”筛选中恢复。`
        : `Delete ${concept.id}?\n${impact}\nThe Concept will move to Archived and can be restored from the Archived filter.`;
      if (!window.confirm(message)) return;
    }
    try {
      const saved = await api<Concept>(`/api/concepts/${encodeURIComponent(concept.id)}/${next}`, { method: "POST", body: JSON.stringify({ expected_version: concept.version }) });
      setSelected(saved);
      setError(""); setRefreshKey((key) => key + 1);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Lifecycle update failed"); }
  };
  const confirmDelete = async () => {
    if (!deleteCandidate || deleteText !== deleteCandidate.id) return;
    if (!window.confirm(locale === "cn" ? `永久删除 ${deleteCandidate.id} 及其修订和专属图片？此操作无法撤销。` : `Permanently delete ${deleteCandidate.id}, its revisions, and its unshared images? This cannot be undone.`)) return;
    try {
      await api(`/api/concepts/${encodeURIComponent(deleteCandidate.id)}`, { method: "DELETE", body: JSON.stringify({ expected_version: deleteCandidate.version, confirm_id: deleteCandidate.id }) });
      setDeleteCandidate(null); setDeleteText(""); setDeleteError(""); closeConcept(); setSelected(null); setError(""); setRefreshKey((key) => key + 1);
    } catch (cause) { setDeleteError(cause instanceof Error ? cause.message : "Delete failed"); }
  };
  const requestDelete = (concept: Concept) => { setDeleteCandidate(concept); setDeleteText(""); setDeleteError(""); };


  return <div className="min-h-screen bg-[#f7f8f5] text-slate-900">
    <header className="sticky top-0 z-30 grid h-16 grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center border-b border-slate-200 bg-white/95 px-3 backdrop-blur md:px-10">
      <div className="flex min-w-0 items-center gap-2 sm:gap-3"><div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-emerald-900 text-white"><Compass size={19} /></div><div className="hidden min-w-0 sm:block"><div className="truncate text-sm font-semibold">Concept Discovery</div><div className="text-[11px] text-slate-500">Local Registry</div></div></div>
      <nav aria-label={locale === "cn" ? "主导航" : "Main navigation"} className="flex h-full items-center gap-0.5">{(["manage", "dashboard"] as const).map((item) => <button key={item} type="button" aria-current={section === item ? "page" : undefined} onClick={() => changeSection(item)} className={`inline-flex h-full items-center border-b-2 px-2 text-[11px] sm:px-3 sm:text-xs ${section === item ? "border-emerald-800 font-semibold text-emerald-900" : "border-transparent text-slate-500 hover:text-slate-800"}`}>{item === "manage" ? t.manage : "Dashboard"}</button>)}</nav>
      <div className="flex justify-self-end items-center gap-1"><button type="button" onClick={() => { setLocale("cn"); }} aria-pressed={locale === "cn"} className={`rounded-lg px-2 py-2 text-[11px] sm:px-3 sm:text-xs ${locale === "cn" ? "bg-emerald-900 text-white" : "text-slate-500 hover:bg-slate-100"}`}>中文</button><button type="button" onClick={() => { setLocale("en"); }} aria-pressed={locale === "en"} className={`rounded-lg px-2 py-2 text-[11px] sm:px-3 sm:text-xs ${locale === "en" ? "bg-emerald-900 text-white" : "text-slate-500 hover:bg-slate-100"}`}>English</button></div>
    </header>
    <main className="mx-auto max-w-6xl px-5 pb-16 md:px-10">
      {section === "dashboard" ? <DashboardView data={dashboard} error={dashboardError} locale={locale} onRefresh={() => setRefreshKey((key) => key + 1)} /> : <>
      <div className="flex flex-wrap items-end justify-between gap-4 py-8"><div><p className="mb-2 text-[11px] font-semibold uppercase tracking-[.18em] text-emerald-800">Concept Registry</p><h1 className="text-3xl font-semibold tracking-tight">{t.manageTitle}</h1><p className="mt-2 text-sm text-slate-500">{t.manageSubtitle}</p></div><button onClick={() => begin()} className="inline-flex items-center gap-2 rounded-xl bg-emerald-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-emerald-800"><Plus size={16} />{t.create}</button></div>
      <div className="sticky top-16 z-20 mb-5 flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-white/95 p-3 shadow-sm backdrop-blur">
        <form onSubmit={submitSearch} role="search" className="flex min-w-48 flex-[2] flex-wrap items-center gap-2">
          <label className="relative min-w-48 flex-1"><Search size={15} className="absolute left-3 top-3 text-slate-400" /><input value={searchInput} onChange={(event) => setSearchInput(event.target.value)} aria-label={t.search} placeholder={t.search} className="w-full rounded-lg border border-slate-200 py-2 pl-9 pr-9 text-sm outline-none focus:border-emerald-700" />{searchInput && <button type="button" onClick={clearSearch} aria-label={locale === "cn" ? "清空搜索" : "Clear search"} className="absolute right-1 top-1 rounded-md p-1.5 text-slate-500 hover:bg-slate-100"><X size={16} /></button>}</label>
          <button type="submit" className="rounded-lg bg-emerald-900 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-800">{locale === "cn" ? "搜索" : "Search"}</button>
          <button type="button" onClick={resetSearch} className="rounded-lg border border-slate-200 px-4 py-2 text-sm text-slate-700 hover:bg-slate-50">{locale === "cn" ? "重置" : "Reset"}</button>
        </form>
        <select value={status} onChange={(event) => setStatus(event.target.value)} aria-label="Status" className="rounded-lg border border-slate-200 px-3 py-2 text-sm"><option value="all">{t.all}</option>{section === "manage" && <option value="draft">{t.draft}</option>}<option value="browsable">{t.browsable}</option><option value="recommendable">{t.recommended}</option>{section === "manage" && <option value="archived">{t.archived}</option>}</select>
        <input value={tag} onChange={(event) => setTag(event.target.value)} aria-label={t.tag} placeholder={t.tag} className="w-28 rounded-lg border border-slate-200 px-3 py-2 text-sm" />
        <div className="w-52 shrink-0"><TaxonomyPicker value={domain} options={taxonomy.domains} locale={locale} chooseLabel={t.chooseDomains} selectedLabel={t.selectedDomains} hint={t.selectDomainHint} confirmLabel={t.confirm} cancelLabel={t.cancel} onChange={setDomain} /></div>
        <div className="ml-auto flex rounded-lg border border-slate-200 p-0.5"><button onClick={() => setDensity("cards")} aria-label="Card view" aria-pressed={density === "cards"} className={`rounded-md p-2 ${density === "cards" ? "bg-emerald-50 text-emerald-900" : "text-slate-400"}`}><Grid2X2 size={16} /></button><button onClick={() => setDensity("table")} aria-label="Table view" aria-pressed={density === "table"} className={`rounded-md p-2 ${density === "table" ? "bg-emerald-50 font-semibold text-emerald-900" : "text-slate-400"}`}><List size={16} /></button></div>
      </div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 text-xs text-slate-500"><div className="flex items-center gap-3"><span>{count} {t.result}</span>{search && <button type="button" onClick={() => { setDiscoveryRequest({ id: crypto.randomUUID(), query: search, locale }); setDrawerOpen(true); }} className="font-medium text-emerald-800 underline">{locale === "cn" ? "查看推荐" : "View suggestions"}</button>}</div><label className="flex items-center gap-2">{t.pageSize}<select aria-label={t.pageSize} value={pageSize} onChange={(event) => { setPageSize(Number(event.target.value)); setPage(1); }} className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-sm text-slate-700"><option value={10}>10</option><option value={20}>20</option><option value={50}>50</option></select></label></div>
      {error && !editor && <p role="alert" className="mb-5 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">{error}</p>}
      {loading ? <p className="text-sm text-slate-500">Loading…</p> : concepts.length === 0 ? <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-6 py-20 text-center"><BookOpen className="mx-auto mb-4 text-emerald-800" size={28} /><h2 className="font-medium">{t.empty}</h2><p className="mt-3 text-sm text-slate-500">{locale === "cn" ? "试试其他关键词或调整筛选，也可以从草稿继续整理。" : "Try different keywords or filters, or continue editing drafts."}</p><button onClick={() => navigate({ status: "draft", search: "", tag: "", domain: [], page: 1 })} className="mt-4 text-sm text-emerald-800 underline">{locale === "cn" ? "查看草稿" : "View drafts"}</button></div> : density === "cards" ? <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">{pageConcepts.map((concept) => <ConceptCard key={concept.id} concept={concept} locale={locale} manage={section === "manage"} selected={selected?.id === concept.id} onSelect={() => openConcept(concept.id)} onOpenRelated={openConcept} onArchive={() => changeLifecycle(concept, "archive")} onRestore={() => changeLifecycle(concept, "restore")} onDelete={() => requestDelete(concept)} />)}</div> : <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white"><table className="w-full min-w-[650px] text-left text-sm"><thead className="bg-slate-50 text-xs text-slate-500"><tr><th className="px-4 py-3">Concept</th><th className="px-4 py-3">{t.tag}</th><th className="px-4 py-3">Status</th>{section === "manage" && <th className="px-4 py-3">{t.actions}</th>}</tr></thead><tbody>{pageConcepts.map((concept) => <tr key={concept.id} className="border-t border-slate-100"><td className="px-4 py-3"><button type="button" onClick={() => openConcept(concept.id)} className="block max-w-sm text-left hover:underline"><span className="font-medium text-emerald-900">{concept.locales[locale].name || concept.id}</span><span className="mt-1 block truncate text-xs text-slate-500">{concept.locales[locale].description}</span></button></td><td className="px-4 py-3 text-slate-500">{concept.locales[locale].tags.join(", ")}</td><td className="px-4 py-3 text-slate-500">{concept.lifecycle_status === "archived" ? t.archived : concept.readiness[locale].browsable ? t.browsable : t.draft}</td>{section === "manage" && <td className="px-4 py-3"><div className="flex flex-wrap items-center gap-x-3 gap-y-1 whitespace-nowrap text-xs"><button type="button" onClick={() => openConcept(concept.id)} className="text-slate-600 hover:text-slate-900">{t.preview}</button><button type="button" onClick={() => begin(concept)} className="text-emerald-800 hover:text-emerald-950">{t.edit}</button>{concept.lifecycle_status === "active" ? <button type="button" onClick={() => changeLifecycle(concept, "archive")} className="text-rose-700 hover:text-rose-900">{t.delete}</button> : <><button type="button" onClick={() => changeLifecycle(concept, "restore")} className="text-emerald-800 hover:text-emerald-950">{locale === "cn" ? "恢复" : "Restore"}</button><button type="button" onClick={() => requestDelete(concept)} className="text-rose-700 hover:text-rose-900">{t.permanentlyDelete}</button></>}</div></td>}</tr>)}</tbody></table></div>}
      {!loading && count > 0 && <div className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm"><span className="text-xs text-slate-500">{(currentPage - 1) * pageSize + 1}–{Math.min(currentPage * pageSize, count)} / {count}</span><div className="flex items-center gap-3"><button type="button" onClick={() => setPage((value) => Math.max(1, value - 1))} disabled={currentPage === 1} className="rounded-lg border border-slate-200 px-3 py-1.5 disabled:cursor-not-allowed disabled:opacity-40">{t.previousPage}</button><span aria-live="polite" className="text-xs text-slate-600">{t.pageOf} {currentPage} {t.ofPages} {pageCount}{locale === "cn" ? " 页" : ""}</span><button type="button" onClick={() => setPage((value) => Math.min(pageCount, value + 1))} disabled={currentPage >= pageCount} className="rounded-lg border border-slate-200 px-3 py-1.5 disabled:cursor-not-allowed disabled:opacity-40">{t.nextPage}</button></div></div>}
      {selectedId && !editor && !deleteCandidate && selected?.id === selectedId && <ConceptDetailModal key={selectedId} concept={selected} locale={locale} onLocale={setLocale} error={error} manage={section === "manage"} refreshKey={refreshKey} onClose={closeConcept} onRefresh={() => setRefreshKey((key) => key + 1)} onEdit={() => begin(selected)} onArchive={() => changeLifecycle(selected, "archive")} onRestore={() => changeLifecycle(selected, "restore")} onDelete={() => requestDelete(selected)} onOpenRelatedConcept={openConcept} />}
      {selectedId && !editor && !deleteCandidate && selected?.id !== selectedId && <Modal title={selectedId} onClose={closeConcept}><div className="p-6"><p role={detailError ? "alert" : "status"}>{detailError || (locale === "cn" ? "读取中…" : "Loading…")}</p><button onClick={closeConcept} className="mt-4 text-emerald-800 underline">{locale === "cn" ? "返回列表" : "Back to library"}</button>{detailError && <button onClick={() => setRefreshKey((key) => key + 1)} className="ml-4 underline">{locale === "cn" ? "重试" : "Retry"}</button>}</div></Modal>}
      </>}
    </main>
    {drawerOpen && discoveryRequest && <RecommendationDrawer locale={discoveryRequest.locale} query={discoveryRequest.query} result={discoveryResult} loading={discoveryLoading} error={discoveryError} onClose={() => setDrawerOpen(false)} onOpenConcept={(id) => { setDrawerOpen(false); openConcept(id); }} />}
    {editor && <ConceptEditor editor={editor} draft={draft} locale={locale} media={media} preview={preview} busy={busy} error={error} conflict={conflict} setField={setField} onSave={save} onClose={closeEditor} onReload={reloadEditor} onChooseImages={chooseImages} onRemoveImage={removeImage} />}
    {deleteCandidate && <Modal title={locale === "cn" ? "永久删除 Concept" : "Permanently delete Concept"} onClose={() => setDeleteCandidate(null)} className="max-w-md"><div className="overflow-y-auto p-6"><p className="mt-3 text-sm text-slate-600">{locale === "cn" ? "仅已归档且无外部引用的 Concept 可删除。记录、修订及专属图片将永久移除。请输入完整 ID 继续。" : "Only archived Concepts without external references can be deleted. The record, revisions, and unshared images will be removed. Enter the full ID to continue."}</p><p className="mt-3 font-mono text-sm font-medium">{deleteCandidate.id}</p><label className="mt-4 block text-sm">{locale === "cn" ? "确认 ID" : "Confirm ID"}<input value={deleteText} onChange={(event) => setDeleteText(event.target.value)} autoFocus className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2" /></label>{deleteError && <p role="alert" className="mt-3 text-sm text-rose-800">{deleteError}</p>}<div className="mt-6 flex justify-end gap-2"><button onClick={() => setDeleteCandidate(null)} className="rounded-lg px-4 py-2 text-sm">{locale === "cn" ? "取消" : "Cancel"}</button><button onClick={confirmDelete} disabled={deleteText !== deleteCandidate.id} className="rounded-lg bg-rose-800 px-4 py-2 text-sm text-white disabled:opacity-50">{locale === "cn" ? "继续删除" : "Continue deletion"}</button></div></div></Modal>}
  </div>;
}



export default App;
