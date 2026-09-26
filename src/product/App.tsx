import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { BookOpen, Check, ChevronLeft, ChevronRight, Compass, Grid2X2, List, Pencil, Plus, RefreshCw, Search, X } from "lucide-react";
import RelationPanel from "./RelationPanel";
import taxonomy from "../../shared/taxonomy.json";

type Locale = "cn" | "en";
type LocaleData = {
  name: string; aliases: string[]; description: string; cover_image: string; cover_images: string[]; wiki_url: string;
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
type DashboardData = {
  active_total: number; both_draft: number; archived_total: number;
  locales: Record<Locale, { browsable: number; recommendable: number }>;
  recent_revisions: { revision_id: number; concept_id: string; version: number; operation: string; changed_at: string; affected_languages: Locale[]; shared_changes: boolean; changed_paths: string[] }[];
  usage: { runs_total: number; none_runs: number; events: Record<"recommended" | "viewed" | "applied" | "ignored" | "not_useful", number>; locales: Record<Locale, { runs_total: number; none_runs: number; events: Record<"recommended" | "viewed" | "applied" | "ignored" | "not_useful", number> }> };
};
type MediaDraftItem = { kind: "existing"; hash: string } | { kind: "new"; id: string; data: string; preview: string; fileName: string };
type MediaDraft = MediaDraftItem[] | null;

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

const storedImages = (data: LocaleData): string[] => data.cover_images?.length ? data.cover_images : data.cover_image ? [data.cover_image] : [];
const mediaPayload = (media: Record<Locale, MediaDraft>) => Object.fromEntries((["cn", "en"] as const).filter((language) => media[language] !== null).map((language) => [language, {
  action: "sync", images: (media[language] ?? []).map((item) => item.kind === "existing" ? { hash: item.hash } : { data: item.data }),
}]));

function updatePayload(concept: Concept, draft: Draft, media: Record<Locale, MediaDraft>) {
  const values = formValues(draft);
  const previous = formValues(fromConcept(concept));
  const changes = Object.fromEntries(Object.entries(values).filter(([path, value]) => JSON.stringify(value) !== JSON.stringify(previous[path])));
  return { expected_version: concept.version, changes, media: mediaPayload(media) };
}

function createPayload(draft: Draft, preview = false, media?: Record<Locale, MediaDraft>) {
  const values = formValues(draft);
  const localeValues = (language: Locale) => Object.fromEntries(Object.entries(values).filter(([path]) => path.startsWith(`locales.${language}.`)).map(([path, value]) => [path.slice(11), value]));
  return { id: preview && !draft.id ? "preview-draft" : draft.id, interaction_type: values.interaction_type, epistemic_type: values.epistemic_type, domains: values.domains, intents: values.intents, locales: { cn: localeValues("cn"), en: localeValues("en") }, ...(media ? { media: mediaPayload(media) } : {}) };
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
  cn: { manage: "管理视图", manageTitle: "Concept 管理", manageSubtitle: "浏览目录并维护中英文内容、草稿与归档词条。", create: "新建 Concept", search: "搜索名称、别名、描述或标签", all: "全部状态", draft: "草稿", browsable: "可浏览", recommended: "可推荐", archived: "已归档", tag: "标签", domain: "领域", intent: "意图", result: "条结果", pageSize: "每页显示", previousPage: "上一页", nextPage: "下一页", pageOf: "第", ofPages: "页，共", empty: "当前没有符合条件的 Concept", edit: "编辑", preview: "预览", delete: "删除", permanentlyDelete: "永久删除", source: "出处", missing: "待补字段", noImage: "暂无图片", actions: "操作", chooseDomains: "选择领域", selectedDomains: "个领域已选", chooseIntents: "选择意图", selectedIntents: "个意图已选", confirm: "确认", cancel: "取消", selectDomainHint: "勾选需要的领域，确认后回填。", selectIntentHint: "勾选需要的意图，确认后回填。", name: "名称", aliases: "别名（逗号分隔）", description: "描述", sourceText: "出处文本", tags: "标签（逗号分隔）", wiki: "Wiki 链接（可选）", trigger: "触发场景（逗号分隔）", avoid: "避免使用情况（逗号分隔）", transform: "转化目标（逗号分隔）", instruction: "Agent 指令", browse: "可浏览", recommend: "可推荐", draftStatus: "草稿", browseMissing: "浏览条件待补", recommendMissing: "推荐条件待补", none: "无", image: "WebP 图片", defaultImage: "使用默认配图", saveBeforeImage: "保存草稿后可添加图片", remove: "移除", idLabel: "ID · 固定标识", newRecord: "新建记录", conceptLabel: "Concept", close: "关闭", save: "保存", saving: "保存中…", cancelLabel: "取消", interactionType: "交互类型", epistemicType: "认识类型", unspecified: "未指定" },
  en: { manage: "Manage Concepts", manageTitle: "Manage Concepts", manageSubtitle: "Browse the registry and maintain both languages, drafts, and archived Concepts.", create: "New Concept", search: "Search name, aliases, description or tags", all: "All statuses", draft: "Draft", browsable: "Browsable", recommended: "Recommendable", archived: "Archived", tag: "Tag", domain: "Domain", intent: "Intent", result: "results", pageSize: "Items per page", previousPage: "Previous", nextPage: "Next", pageOf: "Page", ofPages: "of", empty: "No Concepts match these filters", edit: "Edit", preview: "Preview", delete: "Delete", permanentlyDelete: "Permanently delete", source: "Source", missing: "Missing fields", noImage: "No image", actions: "Actions", chooseDomains: "Choose domains", selectedDomains: "domains selected", chooseIntents: "Choose intents", selectedIntents: "intents selected", confirm: "Confirm", cancel: "Cancel", selectDomainHint: "Check the domains you need, then confirm.", selectIntentHint: "Check the intents you need, then confirm.", name: "Name", aliases: "Aliases · comma separated", description: "Description", sourceText: "Source text", tags: "Tags · comma separated", wiki: "Wiki URL · optional", trigger: "Trigger scenarios · comma separated", avoid: "Avoid when · comma separated", transform: "Transform goals · comma separated", instruction: "Agent instruction", browse: "Browsable", recommend: "Recommendable", draftStatus: "Draft", browseMissing: "Browse missing", recommendMissing: "Recommend missing", none: "none", image: "WebP images", defaultImage: "Using default cover", saveBeforeImage: "Save the draft before adding an image.", remove: "Remove", idLabel: "ID · immutable slug", newRecord: "New record", conceptLabel: "Concept", close: "Close", save: "Save", saving: "Saving…", cancelLabel: "Cancel", interactionType: "Interaction type", epistemicType: "Epistemic type", unspecified: "Unspecified" },
};
const typeNames: Record<string, Record<Locale, string>> = Object.fromEntries(
  [...taxonomy.interaction_types, ...taxonomy.epistemic_types].map(({ code, cn, en }) => [code, { cn, en }]),
);
const optionLabel = (item: { cn: string; en: string }, locale: Locale) => item[locale];
const labelsFor = (concept: Concept, locale: Locale) => [concept.interaction_type, concept.epistemic_type].filter((value): value is string => Boolean(value)).map((value) => typeNames[value]?.[locale] ?? value);

function App() {
  const [locale, setLocale] = useState<Locale>("cn");
  const [section, setSection] = useState<"manage" | "dashboard">("manage");
  const [density, setDensity] = useState<"cards" | "table">("cards");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [tag, setTag] = useState("");
  const [domain, setDomain] = useState<string[]>([]);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
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

  useEffect(() => { setPage(1); }, [locale, section, search, status, tag, domain]);

  useEffect(() => {
    if (section === "dashboard") return;
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      const params = new URLSearchParams({ locale, view: section, q: search, status, tag, domain: domain.join(",") });
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
      setSelected(saved); setEditor(null); setSearch(""); setTag(""); setDomain([]); setStatus("all");
      if (!saved.readiness[locale].browsable) setSection("manage");
      setRefreshKey((current) => current + 1);
    } catch (cause) {
      if (cause instanceof ApiError && cause.code === "version_conflict") setConflict(true);
      setError(cause instanceof Error ? cause.message : "Save failed");
    }
    finally { setBusy(false); }
  };
  const changeSection = (next: "manage" | "dashboard") => { setSection(next); setStatus("all"); setSearch(""); setTag(""); setDomain([]); setSelected(null); };
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
      setDeleteCandidate(null); setDeleteText(""); setDeleteError(""); setSelected(null); setError(""); setRefreshKey((key) => key + 1);
    } catch (cause) { setDeleteError(cause instanceof Error ? cause.message : "Delete failed"); }
  };
  const requestDelete = (concept: Concept) => { setDeleteCandidate(concept); setDeleteText(""); setDeleteError(""); };
  const openRelatedConcept = async (id: string) => {
    try {
      const concept = await api<Concept>(`/api/concepts/${encodeURIComponent(id)}`);
      setStatus("all"); setSearch(""); setTag(""); setDomain([]); setSelected(concept); setError("");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Concept failed to load"); }
  };

  return <div className="min-h-screen bg-[#f7f8f5] text-slate-900">
    <header className="sticky top-0 z-30 grid h-16 grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center border-b border-slate-200 bg-white/95 px-3 backdrop-blur md:px-10">
      <div className="flex min-w-0 items-center gap-2 sm:gap-3"><div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-emerald-900 text-white"><Compass size={19} /></div><div className="hidden min-w-0 sm:block"><div className="truncate text-sm font-semibold">Concept Discovery</div><div className="text-[11px] text-slate-500">Local Registry</div></div></div>
      <nav aria-label={locale === "cn" ? "主导航" : "Main navigation"} className="flex h-full items-center gap-0.5">{(["manage", "dashboard"] as const).map((item) => <button key={item} type="button" aria-current={section === item ? "page" : undefined} onClick={() => changeSection(item)} className={`inline-flex h-full items-center border-b-2 px-2 text-[11px] sm:px-3 sm:text-xs ${section === item ? "border-emerald-800 font-semibold text-emerald-900" : "border-transparent text-slate-500 hover:text-slate-800"}`}>{item === "manage" ? t.manage : "Dashboard"}</button>)}</nav>
      <div className="flex justify-self-end items-center gap-1"><button type="button" onClick={() => { setLocale("cn"); setSelected(null); }} aria-pressed={locale === "cn"} className={`rounded-lg px-2 py-2 text-[11px] sm:px-3 sm:text-xs ${locale === "cn" ? "bg-emerald-900 text-white" : "text-slate-500 hover:bg-slate-100"}`}>中文</button><button type="button" onClick={() => { setLocale("en"); setSelected(null); }} aria-pressed={locale === "en"} className={`rounded-lg px-2 py-2 text-[11px] sm:px-3 sm:text-xs ${locale === "en" ? "bg-emerald-900 text-white" : "text-slate-500 hover:bg-slate-100"}`}>English</button></div>
    </header>
    <main className="mx-auto max-w-6xl px-5 pb-16 md:px-10">
      {section === "dashboard" ? <DashboardView data={dashboard} error={dashboardError} locale={locale} onRefresh={() => setRefreshKey((key) => key + 1)} /> : <>
      <div className="flex flex-wrap items-end justify-between gap-4 py-8"><div><p className="mb-2 text-[11px] font-semibold uppercase tracking-[.18em] text-emerald-800">Concept Registry</p><h1 className="text-3xl font-semibold tracking-tight">{t.manageTitle}</h1><p className="mt-2 text-sm text-slate-500">{t.manageSubtitle}</p></div><button onClick={() => begin()} className="inline-flex items-center gap-2 rounded-xl bg-emerald-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-emerald-800"><Plus size={16} />{t.create}</button></div>
      <div className="sticky top-16 z-20 mb-5 flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-white/95 p-3 shadow-sm backdrop-blur"><label className="relative min-w-48 flex-1"><Search size={15} className="absolute left-3 top-3 text-slate-400" /><input value={search} onChange={(event) => setSearch(event.target.value)} aria-label={t.search} placeholder={t.search} className="w-full rounded-lg border border-slate-200 py-2 pl-9 pr-3 text-sm outline-none focus:border-emerald-700" /></label><select value={status} onChange={(event) => setStatus(event.target.value)} aria-label="Status" className="rounded-lg border border-slate-200 px-3 py-2 text-sm"><option value="all">{t.all}</option>{section === "manage" && <option value="draft">{t.draft}</option>}<option value="browsable">{t.browsable}</option><option value="recommendable">{t.recommended}</option>{section === "manage" && <option value="archived">{t.archived}</option>}</select><input value={tag} onChange={(event) => setTag(event.target.value)} aria-label={t.tag} placeholder={t.tag} className="w-28 rounded-lg border border-slate-200 px-3 py-2 text-sm" /><div className="w-52 shrink-0"><TaxonomyPicker value={domain} options={taxonomy.domains} locale={locale} chooseLabel={t.chooseDomains} selectedLabel={t.selectedDomains} hint={t.selectDomainHint} confirmLabel={t.confirm} cancelLabel={t.cancel} onChange={setDomain} /></div><div className="ml-auto flex rounded-lg border border-slate-200 p-0.5"><button onClick={() => setDensity("cards")} aria-label="Card view" aria-pressed={density === "cards"} className={`rounded-md p-2 ${density === "cards" ? "bg-emerald-50 text-emerald-900" : "text-slate-400"}`}><Grid2X2 size={16} /></button><button onClick={() => setDensity("table")} aria-label="Table view" aria-pressed={density === "table"} className={`rounded-md p-2 ${density === "table" ? "bg-emerald-50 text-emerald-900" : "text-slate-400"}`}><List size={16} /></button></div></div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 text-xs text-slate-500"><span>{count} {t.result}</span><label className="flex items-center gap-2">{t.pageSize}<select aria-label={t.pageSize} value={pageSize} onChange={(event) => { setPageSize(Number(event.target.value)); setPage(1); }} className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-sm text-slate-700"><option value={10}>10</option><option value={20}>20</option><option value={50}>50</option></select></label></div>
      {error && !editor && <p role="alert" className="mb-5 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">{error}</p>}
      {loading ? <p className="text-sm text-slate-500">Loading…</p> : concepts.length === 0 ? <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-6 py-20 text-center"><BookOpen className="mx-auto mb-4 text-emerald-800" size={28} /><h2 className="font-medium">{t.empty}</h2></div> : density === "cards" ? <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">{pageConcepts.map((concept) => <ConceptCard key={concept.id} concept={concept} locale={locale} manage={section === "manage"} selected={selected?.id === concept.id} onSelect={() => setSelected(concept)} onArchive={() => changeLifecycle(concept, "archive")} onRestore={() => changeLifecycle(concept, "restore")} onDelete={() => requestDelete(concept)} />)}</div> : <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white"><table className="w-full min-w-[650px] text-left text-sm"><thead className="bg-slate-50 text-xs text-slate-500"><tr><th className="px-4 py-3">Concept</th><th className="px-4 py-3">{t.tag}</th><th className="px-4 py-3">Status</th>{section === "manage" && <th className="px-4 py-3">{t.actions}</th>}</tr></thead><tbody>{pageConcepts.map((concept) => <tr key={concept.id} className="border-t border-slate-100"><td className="px-4 py-3"><button type="button" onClick={() => setSelected(concept)} className="block max-w-sm text-left hover:underline"><span className="font-medium text-emerald-900">{concept.locales[locale].name || concept.id}</span><span className="mt-1 block truncate text-xs text-slate-500">{concept.locales[locale].description}</span></button></td><td className="px-4 py-3 text-slate-500">{concept.locales[locale].tags.join(", ")}</td><td className="px-4 py-3 text-slate-500">{concept.lifecycle_status === "archived" ? t.archived : concept.readiness[locale].recommendable ? t.recommended : concept.readiness[locale].browsable ? t.browsable : t.draft}</td>{section === "manage" && <td className="px-4 py-3"><div className="flex flex-wrap items-center gap-x-3 gap-y-1 whitespace-nowrap text-xs"><button type="button" onClick={() => setSelected(concept)} className="text-slate-600 hover:text-slate-900">{t.preview}</button><button type="button" onClick={() => begin(concept)} className="text-emerald-800 hover:text-emerald-950">{t.edit}</button>{concept.lifecycle_status === "active" ? <button type="button" onClick={() => changeLifecycle(concept, "archive")} className="text-rose-700 hover:text-rose-900">{t.delete}</button> : <><button type="button" onClick={() => changeLifecycle(concept, "restore")} className="text-emerald-800 hover:text-emerald-950">{locale === "cn" ? "恢复" : "Restore"}</button><button type="button" onClick={() => requestDelete(concept)} className="text-rose-700 hover:text-rose-900">{t.permanentlyDelete}</button></>}</div></td>}</tr>)}</tbody></table></div>}
      {!loading && count > 0 && <div className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm"><span className="text-xs text-slate-500">{(currentPage - 1) * pageSize + 1}–{Math.min(currentPage * pageSize, count)} / {count}</span><div className="flex items-center gap-3"><button type="button" onClick={() => setPage((value) => Math.max(1, value - 1))} disabled={currentPage === 1} className="rounded-lg border border-slate-200 px-3 py-1.5 disabled:cursor-not-allowed disabled:opacity-40">{t.previousPage}</button><span aria-live="polite" className="text-xs text-slate-600">{t.pageOf} {currentPage} {t.ofPages} {pageCount}{locale === "cn" ? " 页" : ""}</span><button type="button" onClick={() => setPage((value) => Math.min(pageCount, value + 1))} disabled={currentPage >= pageCount} className="rounded-lg border border-slate-200 px-3 py-1.5 disabled:cursor-not-allowed disabled:opacity-40">{t.nextPage}</button></div></div>}
      {selected && <ConceptDetailModal concept={selected} locale={locale} manage={section === "manage"} refreshKey={refreshKey} onClose={() => setSelected(null)} onRefresh={() => setRefreshKey((key) => key + 1)} onEdit={() => begin(selected)} onArchive={() => changeLifecycle(selected, "archive")} onRestore={() => changeLifecycle(selected, "restore")} onDelete={() => requestDelete(selected)} onOpenRelatedConcept={openRelatedConcept} />}
      </>}
    </main>
    {editor && <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-950/40 p-3" onMouseDown={(event) => { if (event.target === event.currentTarget) setEditor(null); }}><form onSubmit={save} className="flex max-h-[94vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl"><div className="flex items-center justify-between border-b border-slate-200 px-6 py-5"><div><p className="text-xs font-medium text-emerald-800">{editor === "create" ? t.newRecord : `${editor.id} · v${editor.version}`}</p><h2 className="mt-1 text-xl font-semibold">{t.conceptLabel}</h2></div><button type="button" onClick={() => setEditor(null)} aria-label={t.close} className="rounded-lg p-2 hover:bg-slate-100"><X size={18} /></button></div><div className="grid gap-5 overflow-y-auto p-6 md:grid-cols-2"><label className="block text-xs font-medium text-slate-600 md:col-span-2">{t.idLabel}<input value={draft.id} disabled={editor !== "create"} onChange={(event) => setField("id", event.target.value)} required className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm disabled:bg-slate-100" placeholder="first-principles" /></label>{(["cn", "en"] as const).map((language) => <LanguageForm key={language} language={language} draft={draft} setField={setField} existingImages={editor !== "create" && editor ? storedImages(editor.locales[language]) : []} media={media[language]} onChooseImages={(files) => chooseImages(language, files)} onRemoveImage={(index) => removeImage(language, index)} readiness={preview?.[language] ?? (editor !== "create" ? editor.readiness[language] : null)} />)}<div className="grid gap-4 md:col-span-2 md:grid-cols-2"><label className="text-xs font-medium text-slate-600">{t.interactionType}<select value={draft.interactionType} onChange={(event) => setField("interactionType", event.target.value)} className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm"><option value="">{t.unspecified}</option>{taxonomy.interaction_types.map((item) => <option key={item.code} value={item.code}>{optionLabel(item, locale)}</option>)}</select></label><label className="text-xs font-medium text-slate-600">{t.epistemicType}<select value={draft.epistemicType} onChange={(event) => setField("epistemicType", event.target.value)} className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm"><option value="">{t.unspecified}</option>{taxonomy.epistemic_types.map((item) => <option key={item.code} value={item.code}>{optionLabel(item, locale)}</option>)}</select></label><TaxonomyPicker value={draft.domains} options={taxonomy.domains} locale={locale} label={t.domain} chooseLabel={t.chooseDomains} selectedLabel={t.selectedDomains} hint={t.selectDomainHint} confirmLabel={t.confirm} cancelLabel={t.cancel} onChange={(domains) => setField("domains", domains)} /><TaxonomyPicker value={draft.intents} options={taxonomy.intents} locale={locale} label={t.intent} chooseLabel={t.chooseIntents} selectedLabel={t.selectedIntents} hint={t.selectIntentHint} confirmLabel={t.confirm} cancelLabel={t.cancel} onChange={(intents) => setField("intents", intents)} /></div></div>{(error || conflict) && <div role="alert" className="mx-6 mb-3 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-800"><p>{conflict ? (locale === "cn" ? "此 Concept 已在另一会话更新。重新载入最新版本后再编辑。" : "This Concept changed in another session. Reload the latest version before editing.") : error}</p>{conflict && <button type="button" onClick={reloadEditor} className="mt-2 rounded-md border border-rose-300 bg-white px-3 py-1.5 font-medium">{locale === "cn" ? "重新载入最新版本（放弃未保存修改）" : "Reload latest (discard unsaved edits)"}</button>}</div>}<div className="flex justify-end gap-2 border-t border-slate-200 bg-slate-50 px-6 py-4"><button type="button" onClick={() => setEditor(null)} className="rounded-lg px-4 py-2 text-sm text-slate-600 hover:bg-slate-100">{t.cancelLabel}</button><button type="submit" disabled={busy} className="inline-flex items-center gap-2 rounded-lg bg-emerald-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"><Check size={15} />{busy ? t.saving : t.save}</button></div></form></div>}
    {deleteCandidate && <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4"><div role="dialog" aria-modal="true" aria-label={locale === "cn" ? "确认永久删除" : "Confirm permanent deletion"} className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl"><h2 className="text-lg font-semibold text-rose-900">{locale === "cn" ? "永久删除 Concept" : "Permanently delete Concept"}</h2><p className="mt-3 text-sm text-slate-600">{locale === "cn" ? "仅已归档且无外部引用的 Concept 可删除。记录、修订及专属图片将永久移除。请输入完整 ID 继续。" : "Only archived Concepts without external references can be deleted. The record, revisions, and unshared images will be removed. Enter the full ID to continue."}</p><p className="mt-3 font-mono text-sm font-medium">{deleteCandidate.id}</p><label className="mt-4 block text-sm">{locale === "cn" ? "确认 ID" : "Confirm ID"}<input value={deleteText} onChange={(event) => setDeleteText(event.target.value)} autoFocus className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2" /></label>{deleteError && <p role="alert" className="mt-3 text-sm text-rose-800">{deleteError}</p>}<div className="mt-6 flex justify-end gap-2"><button onClick={() => setDeleteCandidate(null)} className="rounded-lg px-4 py-2 text-sm">{locale === "cn" ? "取消" : "Cancel"}</button><button onClick={confirmDelete} disabled={deleteText !== deleteCandidate.id} className="rounded-lg bg-rose-800 px-4 py-2 text-sm text-white disabled:opacity-50">{locale === "cn" ? "继续删除" : "Continue deletion"}</button></div></div></div>}
  </div>;
}


function ConceptDetailModal({ concept, locale, manage, refreshKey, onClose, onRefresh, onEdit, onArchive, onRestore, onDelete, onOpenRelatedConcept }: {
  concept: Concept; locale: Locale; manage: boolean; refreshKey: number;
  onClose: () => void; onRefresh: () => void; onEdit: () => void; onArchive: () => void;
  onRestore: () => void; onDelete: () => void; onOpenRelatedConcept: (id: string) => void;
}) {
  const cn = locale === "cn";
  const commonFields: [string, string][] = [
    [cn ? "ID" : "ID", concept.id],
    [cn ? "状态" : "Status", concept.lifecycle_status === "active" ? (cn ? "活跃" : "Active") : (cn ? "已归档" : "Archived")],
    [cn ? "版本" : "Version", String(concept.version)],
    [cn ? "交互类型" : "Interaction type", concept.interaction_type ? (typeNames[concept.interaction_type]?.[locale] ?? concept.interaction_type) : "—"],
    [cn ? "认识类型" : "Epistemic type", concept.epistemic_type ? (typeNames[concept.epistemic_type]?.[locale] ?? concept.epistemic_type) : "—"],
    [cn ? "领域" : "Domains", concept.domains.join(" · ") || "—"],
    [cn ? "意图" : "Intents", concept.intents.join(" · ") || "—"],
    [cn ? "创建时间" : "Created", concept.created_at || "—"],
    [cn ? "更新时间" : "Updated", concept.updated_at || "—"],
  ];
  const localeFieldLabels: Record<Locale, Record<keyof LocaleData, string>> = {
    cn: { name: "名称", aliases: "别名", description: "描述", cover_image: "配图", cover_images: "图片", wiki_url: "Wiki 链接", tags: "标签", trigger: "触发场景", avoid_when: "避免使用", transform: "转化目标", agent_instruction: "Agent 指令", source_text: "出处文本" },
    en: { name: "Name", aliases: "Aliases", description: "Description", cover_image: "Cover image", cover_images: "Images", wiki_url: "Wiki URL", tags: "Tags", trigger: "Trigger scenarios", avoid_when: "Avoid when", transform: "Transform goals", agent_instruction: "Agent instruction", source_text: "Source text" },
  };
  const formatValue = (value: string | string[]) => Array.isArray(value) ? value.join(" · ") || "—" : value || "—";
  const readinessLabel = (language: Locale, ready: Readiness) => `${language.toUpperCase()} · ${ready.recommendable ? (cn ? "可推荐" : "Recommendable") : ready.browsable ? (cn ? "可浏览" : "Browsable") : (cn ? "草稿" : "Draft")} · ${cn ? "浏览缺项" : "Browse missing"}: ${ready.browse_missing.join(", ") || "—"} · ${cn ? "推荐缺项" : "Recommend missing"}: ${ready.recommend_missing.join(", ") || "—"}`;
  return <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-950/40 p-3" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section role="dialog" aria-modal="true" aria-label={concept.locales[locale].name || concept.id} className="max-h-[94vh] w-full max-w-5xl overflow-y-auto rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl sm:p-6" onMouseDown={(event) => event.stopPropagation()}>
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-100 pb-4"><div><p className="text-xs font-medium uppercase tracking-wider text-emerald-800">{concept.id} · v{concept.version}</p><h2 className="mt-2 text-xl font-semibold">{concept.locales[locale].name || concept.id}</h2></div><div className="flex flex-wrap gap-2">{manage && <><button type="button" onClick={onRefresh} aria-label="Reload" className="rounded-lg border border-slate-200 p-2.5 hover:bg-slate-50"><RefreshCw size={15} /></button><button type="button" onClick={onEdit} className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm hover:bg-slate-50"><Pencil size={14} />{cn ? "编辑" : "Edit"}</button>{concept.lifecycle_status === "active" ? <button type="button" onClick={onArchive} className="rounded-lg border border-rose-300 px-3 py-2 text-sm text-rose-800">{cn ? "删除" : "Delete"}</button> : <><button type="button" onClick={onRestore} className="rounded-lg border border-emerald-300 px-3 py-2 text-sm text-emerald-900">{cn ? "恢复" : "Restore"}</button><button type="button" onClick={onDelete} className="rounded-lg border border-rose-300 px-3 py-2 text-sm text-rose-800">{cn ? "永久删除" : "Permanently delete"}</button></>}</>}<button type="button" onClick={onClose} aria-label={cn ? "关闭详情" : "Close details"} className="rounded-lg border border-slate-200 p-2.5 hover:bg-slate-50"><X size={15} /></button></div></div>
      <section className="mt-5" aria-label={cn ? "共用字段" : "Shared fields"}><h3 className="text-sm font-semibold">{cn ? "共用字段" : "Shared fields"}</h3><dl className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{commonFields.map(([label, value]) => <DetailField key={label} label={label} value={value} />)}</dl></section>
      <ImagePreviewGroup concept={concept} locale={locale} />
      <div className="mt-5 grid gap-4 lg:grid-cols-2">{(["cn", "en"] as const).map((language) => <section key={language} className="rounded-xl border border-slate-200 p-4" aria-label={language === "cn" ? "中文内容" : "English content"}><h3 className="font-semibold">{language === "cn" ? "中文内容 · cn" : "English content · en"}</h3><dl className="mt-3 grid gap-3">{(Object.keys(localeFieldLabels[language]) as (keyof LocaleData)[]).filter((key) => key !== "cover_image" && key !== "cover_images").map((key) => <DetailField key={key} label={localeFieldLabels[language][key]} value={formatValue(concept.locales[language][key])} multiline={key === "description" || key === "source_text" || key === "agent_instruction"} />)}</dl><p className="mt-4 rounded-lg bg-slate-50 px-3 py-2 text-xs leading-relaxed text-slate-600">{readinessLabel(language, concept.readiness[language])}</p></section>)}</div>
      <RelationPanel conceptId={concept.id} lifecycleStatus={concept.lifecycle_status} locale={locale} manage={manage} refreshKey={refreshKey} onOpenConcept={onOpenRelatedConcept} />
    </section>
  </div>;
}

function DetailField({ label, value, multiline = false }: { label: string; value: string; multiline?: boolean }) {
  return <div className="min-w-0 border-b border-slate-100 pb-2 last:border-0"><dt className="text-[11px] font-medium text-slate-500">{label}</dt><dd className={`mt-1 break-words text-sm text-slate-800 ${multiline ? "whitespace-pre-wrap" : ""}`}>{value}</dd></div>;
}

function ImagePreviewGroup({ concept, locale }: { concept: Concept; locale: Locale }) {
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);
  const images = (["cn", "en"] as const).flatMap((language) => storedImages(concept.locales[language]).map((hash, localeIndex) => ({
    language, localeIndex, src: `/api/assets/${hash}`, alt: `${language === "cn" ? "中文" : "English"} ${localeIndex + 1} · ${concept.locales[language].name || concept.id}`,
  })));
  useEffect(() => {
    if (previewIndex === null) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setPreviewIndex(null);
      if (event.key === "ArrowLeft") setPreviewIndex((index) => index === null ? null : (index + images.length - 1) % images.length);
      if (event.key === "ArrowRight") setPreviewIndex((index) => index === null ? null : (index + 1) % images.length);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [images.length, previewIndex]);
  return <section className="mt-5" aria-label={locale === "cn" ? "中英文图片预览" : "Chinese and English image previews"}><h3 className="text-sm font-semibold">{locale === "cn" ? "图片预览" : "Image previews"}</h3><div className="mt-3 grid gap-3 sm:grid-cols-2">{(["cn", "en"] as const).map((language) => {
    const languageImages = images.filter((image) => image.language === language);
    return <div key={language} className="flex min-h-20 items-center gap-3 rounded-lg border border-slate-200 p-2"><span className="w-12 shrink-0 text-xs font-medium text-slate-600">{language === "cn" ? "中文" : "English"}</span><div className="flex flex-wrap gap-2">{languageImages.length ? languageImages.map((image) => {
      const index = images.indexOf(image);
      return <button type="button" key={`${image.language}-${image.localeIndex}`} onClick={() => setPreviewIndex(index)} aria-label={language === "cn" ? `预览中文图片 ${image.localeIndex + 1}` : `Preview English image ${image.localeIndex + 1}`} className="group h-16 w-24 overflow-hidden rounded-md bg-slate-100"><img src={image.src} alt="" className="h-full w-full object-cover transition group-hover:scale-105" /></button>;
    }) : <div role="img" aria-label={language === "cn" ? "中文默认图片" : "English default image"} className="flex h-16 w-24 items-center justify-center rounded-md bg-slate-100"><BookOpen size={20} className="text-slate-400" /></div>}</div></div>;
  })}</div>{previewIndex !== null && images[previewIndex] && <div role="dialog" aria-modal="true" aria-label={locale === "cn" ? "图片预览" : "Image preview"} className="fixed inset-0 z-[60] flex items-center justify-center bg-black/90 p-5" onMouseDown={(event) => { if (event.target === event.currentTarget) setPreviewIndex(null); }}><button type="button" onClick={() => setPreviewIndex(null)} aria-label={locale === "cn" ? "关闭图片预览" : "Close image preview"} className="absolute right-5 top-5 rounded-full bg-white/10 p-3 text-white hover:bg-white/20"><X size={20} /></button>{images.length > 1 && <button type="button" onClick={() => setPreviewIndex((previewIndex + images.length - 1) % images.length)} aria-label={locale === "cn" ? "上一张" : "Previous image"} className="absolute left-4 rounded-full bg-white/10 p-3 text-white hover:bg-white/20"><ChevronLeft size={24} /></button>}<img src={images[previewIndex].src} alt={images[previewIndex].alt} className="max-h-[86vh] max-w-[88vw] object-contain" />{images.length > 1 && <><button type="button" onClick={() => setPreviewIndex((previewIndex + 1) % images.length)} aria-label={locale === "cn" ? "下一张" : "Next image"} className="absolute right-4 rounded-full bg-white/10 p-3 text-white hover:bg-white/20"><ChevronRight size={24} /></button><span className="absolute bottom-5 text-sm text-white">{previewIndex + 1} / {images.length}</span></>}</div>}</section>;
}

function DashboardView({ data, error, locale, onRefresh }: { data: DashboardData | null; error: string; locale: Locale; onRefresh: () => void }) {
  const cn = locale === "cn";
  const metric = (label: string, value: number) => <div className="rounded-2xl border border-slate-200 bg-white p-5"><p className="text-xs text-slate-500">{label}</p><p className="mt-3 text-3xl font-semibold text-emerald-950">{value}</p></div>;
  return <section className="py-8" aria-label="Dashboard">
    <div className="flex flex-wrap items-start justify-between gap-4"><div><p className="mb-2 text-[11px] font-semibold uppercase tracking-[.18em] text-emerald-800">Concept Registry</p><h1 className="text-3xl font-semibold tracking-tight">Dashboard</h1><p className="mt-2 text-sm text-slate-500">{cn ? "实时目录数量与修订，来自同一份本地 Registry。" : "Live catalog counts and revisions from the same local Registry."}</p></div><button onClick={onRefresh} className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"><RefreshCw size={15} />{cn ? "刷新" : "Refresh"}</button></div>
    {error && <p role="alert" className="mt-5 rounded-lg bg-rose-50 px-4 py-3 text-sm text-rose-800">{error}</p>}
    {!data ? <p className="mt-8 text-sm text-slate-500">{cn ? "读取中…" : "Loading…"}</p> : <>
      <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{metric(cn ? "活跃 Concept" : "Active Concepts", data.active_total)}{metric(cn ? "双语均为草稿" : "Draft in both locales", data.both_draft)}{metric(cn ? "归档 Concept" : "Archived Concepts", data.archived_total)}</div>
      <div className="mt-8 grid gap-4 md:grid-cols-2">{(["cn", "en"] as const).map((language) => <div key={language} className="rounded-2xl border border-slate-200 bg-white p-5"><h2 className="font-semibold">{language === "cn" ? "中文 · cn" : "English · en"}</h2><dl className="mt-4 grid grid-cols-2 gap-3"><div className="rounded-xl bg-emerald-50 p-4"><dt className="text-xs text-emerald-900">{cn ? "可浏览" : "Browsable"}</dt><dd className="mt-2 text-2xl font-semibold">{data.locales[language].browsable}</dd></div><div className="rounded-xl bg-emerald-50 p-4"><dt className="text-xs text-emerald-900">{cn ? "可推荐" : "Recommendable"}</dt><dd className="mt-2 text-2xl font-semibold">{data.locales[language].recommendable}</dd></div></dl></div>)}</div>
      <p className="mt-3 text-xs text-slate-500">{cn ? "同一 Concept 可同时计入 cn 与 en；两列不可相加作为去重总数。" : "A Concept can count in both cn and en; do not add the locale counts as a unique total."}</p>
      <div className="mt-8 rounded-2xl border border-slate-200 bg-white p-5"><h2 className="font-semibold">{cn ? "最近修订" : "Recent revisions"}</h2>{data.recent_revisions.length === 0 ? <p className="mt-4 text-sm text-slate-500">{cn ? "暂无修订" : "No revisions"}</p> : <ul className="mt-4 divide-y divide-slate-100">{data.recent_revisions.map((revision) => <li key={revision.revision_id} className="flex flex-wrap items-start justify-between gap-2 py-3 text-sm"><div><span className="font-medium">{revision.concept_id}</span><span className="ml-2 text-slate-500">v{revision.version} · {revision.operation}</span><p className="mt-1 text-xs text-slate-500">{cn ? "影响语言" : "Locales"}: {revision.affected_languages.join(", ") || (cn ? "共用字段" : "shared fields")}{revision.shared_changes && revision.affected_languages.length > 0 ? (cn ? " · 含共用字段" : " · includes shared fields") : ""}</p></div><time dateTime={revision.changed_at} className="text-xs text-slate-500">{new Date(revision.changed_at).toLocaleString()}</time></li>)}</ul>}</div>
      <section className="mt-8" aria-label="Skill usage"><h2 className="font-semibold">{cn ? "Skill 使用与反馈" : "Skill usage and feedback"}</h2><p className="mt-2 text-xs text-slate-500">{cn ? "只统计主动调用 Skill 的事件；推荐按 Concept 次数，空推荐按调用次数。离线 Eval 不计入。" : "Only explicit Skill events; recommendations count Concepts, NONE counts runs. Offline Eval is excluded."}</p><div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{metric(cn ? "调用次数" : "Runs", data.usage.runs_total)}{metric(cn ? "空推荐次数" : "NONE runs", data.usage.none_runs)}{metric(cn ? "推荐次数" : "Recommended", data.usage.events.recommended)}{metric(cn ? "实际应用" : "Applied", data.usage.events.applied)}</div><div className="mt-3 grid gap-3 sm:grid-cols-3">{metric(cn ? "查看详情" : "Viewed", data.usage.events.viewed)}{metric(cn ? "忽略" : "Ignored", data.usage.events.ignored)}{metric(cn ? "无帮助" : "Not useful", data.usage.events.not_useful)}</div><div className="mt-4 grid gap-3 md:grid-cols-2">{(["cn", "en"] as const).map((language) => <div key={language} className="rounded-xl border border-slate-200 bg-white p-4 text-sm"><h3 className="font-medium">{language === "cn" ? "中文 · cn" : "English · en"}</h3><p className="mt-2 text-slate-600">{cn ? "调用 / 空推荐 / 推荐 / 应用" : "Runs / NONE / Recommended / Applied"}: {data.usage.locales[language].runs_total} / {data.usage.locales[language].none_runs} / {data.usage.locales[language].events.recommended} / {data.usage.locales[language].events.applied}</p></div>)}</div></section>
    </>}
  </section>;
}

function ConceptCard({ concept, locale, manage, selected, onSelect, onArchive, onRestore, onDelete }: { concept: Concept; locale: Locale; manage: boolean; selected: boolean; onSelect: () => void; onArchive: () => void; onRestore: () => void; onDelete: () => void }) {
  const local = concept.locales[locale];
  const ready = concept.readiness[locale];
  return <article className={`overflow-hidden rounded-2xl border bg-white shadow-sm ${selected ? "border-emerald-800" : "border-slate-200"}`}>
    <button type="button" onClick={onSelect} className="block w-full text-left transition hover:bg-slate-50">
      <div className="flex h-36 items-center justify-center bg-gradient-to-br from-emerald-50 to-slate-100 text-emerald-700">{local.cover_image ? <img src={"/api/assets/" + local.cover_image} alt="" className="h-full w-full object-cover" /> : <BookOpen size={28} />}</div>
      <div className="p-5"><div className="mb-3 flex justify-between gap-2"><span className="rounded-full bg-amber-50 px-2.5 py-1 text-[11px] font-medium text-amber-800">{concept.lifecycle_status === "archived" ? (locale === "cn" ? "已归档" : "Archived") : ready.recommendable ? (locale === "cn" ? "可推荐" : "Recommendable") : ready.browsable ? (locale === "cn" ? "可浏览" : "Browsable") : (locale === "cn" ? "草稿" : "Draft")}</span><span className="text-xs text-slate-400">v{concept.version}</span></div><h2 className="truncate text-lg font-semibold">{local.name || concept.id}</h2><p className="mt-1 line-clamp-2 min-h-10 text-sm text-slate-500">{local.description || (locale === "cn" ? "当前语言内容待补" : "Content pending in this language")}</p>{local.tags.length > 0 && <p className="mt-3 truncate text-xs text-emerald-800">{local.tags.join(" · ")}</p>}{labelsFor(concept, locale).length > 0 && <p className="mt-2 text-xs text-slate-500">{labelsFor(concept, locale).join(" · ")}</p>}{manage && concept.lifecycle_status === "active" && !ready.browsable && <p className="mt-3 text-xs text-amber-800">{ready.browse_missing.join(", ")}</p>}<div className="mt-4 border-t border-slate-100 pt-3 text-xs text-slate-400">{concept.id}</div></div>
    </button>
    {manage && <div className="flex flex-wrap gap-2 border-t border-slate-100 px-4 py-3">{concept.lifecycle_status === "active" ? <button type="button" onClick={onArchive} className="rounded-md border border-rose-300 px-2.5 py-1.5 text-xs text-rose-800">{locale === "cn" ? "删除" : "Delete"}</button> : <><button type="button" onClick={onRestore} className="rounded-md border border-emerald-300 px-2.5 py-1.5 text-xs text-emerald-900">{locale === "cn" ? "恢复" : "Restore"}</button><button type="button" onClick={onDelete} className="rounded-md border border-rose-300 px-2.5 py-1.5 text-xs text-rose-800">{locale === "cn" ? "永久删除" : "Permanently delete"}</button></>}</div>}
  </article>;
}

function TaxonomyPicker({ value, options, locale, label, chooseLabel, selectedLabel, hint, confirmLabel, cancelLabel, onChange }: {
  value: string[]; options: readonly { code: string; cn: string; en: string }[]; locale: Locale; label?: string; chooseLabel: string; selectedLabel: string; hint: string;
  confirmLabel: string; cancelLabel: string; onChange: (codes: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState<string[]>(value);
  useEffect(() => {
    if (!open) return;
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [open]);
  const rows = Array.from({ length: Math.ceil(options.length / 6) }, (_, index) => options.slice(index * 6, index * 6 + 6));
  const names = value.map((code) => options.find((item) => item.code === code)?.[locale] ?? code);
  const toggle = (code: string) => setPending((current) => current.includes(code) ? current.filter((item) => item !== code) : [...current, code]);
  return <div className="text-xs font-medium text-slate-600">
    {label && <span>{label}</span>}
    <button type="button" aria-haspopup="dialog" aria-expanded={open} onClick={() => { setPending(value); setOpen(true); }} className={`${label ? "mt-1.5 " : ""}flex min-h-10 w-full items-center justify-between gap-3 rounded-lg border border-slate-300 bg-white px-3 py-2 text-left text-sm font-normal text-slate-700 hover:border-emerald-700`}>
      <span className="truncate">{names.length ? names.slice(0, 3).join("、") + (names.length > 3 ? ` +${names.length - 3}` : "") : chooseLabel}</span>
      <span className="shrink-0 text-xs text-slate-500">{value.length} {selectedLabel}</span>
    </button>
    {open && createPortal(<div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/50 p-3" onMouseDown={(event) => { if (event.target === event.currentTarget) setOpen(false); }}>
      <section role="dialog" aria-modal="true" aria-label={chooseLabel} className="flex max-h-[88vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl" onMouseDown={(event) => event.stopPropagation()}>
        <header className="flex items-start justify-between gap-4 border-b border-slate-200 px-5 py-4 sm:px-6"><div><h3 className="text-lg font-semibold text-slate-900">{chooseLabel}</h3><p className="mt-1 text-sm font-normal text-slate-500">{hint}</p></div><button type="button" aria-label={locale === "cn" ? "关闭" : "Close"} onClick={() => setOpen(false)} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100"><X size={18} /></button></header>
        <div className="overflow-auto p-4 sm:p-6"><div className="min-w-[900px] overflow-hidden rounded-xl border border-slate-200"><div role="grid" className="grid grid-cols-6">{rows.flatMap((row, rowIndex) => Array.from({ length: 6 }, (_, columnIndex) => {
          const item = row[columnIndex];
          return <div role="gridcell" key={item?.code ?? `empty-${rowIndex}-${columnIndex}`} className={`flex min-h-12 items-center border-b px-2.5 py-2 text-sm ${columnIndex < 5 ? "border-r" : ""} border-slate-200 ${item ? "hover:bg-emerald-50" : "bg-slate-50/50"}`}>
            {item && <label className="flex w-full cursor-pointer items-center gap-2"><input type="checkbox" checked={pending.includes(item.code)} onChange={() => toggle(item.code)} className="h-4 w-4 shrink-0 accent-emerald-800" /><span className="break-words leading-snug">{optionLabel(item, locale)}</span></label>}
          </div>;
        }))}</div></div></div>
        <footer className="flex items-center justify-between gap-3 border-t border-slate-200 bg-slate-50 px-5 py-4 sm:px-6"><p className="text-sm font-normal text-slate-600">{pending.length} {selectedLabel}</p><div className="flex gap-2"><button type="button" onClick={() => setOpen(false)} className="rounded-lg px-4 py-2 text-sm text-slate-600 hover:bg-slate-100">{cancelLabel}</button><button type="button" onClick={() => { onChange(pending); setOpen(false); }} className="rounded-lg bg-emerald-900 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-800">{confirmLabel}</button></div></footer>
      </section>
    </div>, document.body)}
  </div>;
}

function LanguageForm({ language, draft, setField, existingImages, media, onChooseImages, onRemoveImage, readiness }: {
  language: Locale; draft: Draft; setField: <K extends keyof Draft>(key: K, value: Draft[K]) => void;
  existingImages: string[]; media: MediaDraft;
  onChooseImages: (files?: FileList | File[]) => void; onRemoveImage: (index: number) => void; readiness: Readiness | null;
}) {
  const prefix = language === "cn" ? "cn" : "en";
  const copy = words[language];
  type Suffix = "Name" | "Aliases" | "Description" | "Source" | "Tags" | "Wiki" | "Trigger" | "Avoid" | "Transform" | "Instruction";
  const value = (suffix: Suffix) => draft[`${prefix}${suffix}`];
  const update = (suffix: Suffix, next: string) => setField(`${prefix}${suffix}`, next);
  const images: MediaDraftItem[] = media ?? existingImages.map((hash) => ({ kind: "existing", hash }));
  const fieldNames: Record<string, string> = language === "cn" ? { name: "名称", description: "描述", source_text: "出处文本", trigger: "触发场景", agent_instruction: "Agent 指令" } : { name: "name", description: "description", source_text: "source text", trigger: "trigger", agent_instruction: "agent instruction" };
  const missing = (fields: string[]) => fields.map((field) => fieldNames[field] ?? field).join(language === "cn" ? "、" : ", ") || copy.none;
  return <section className="space-y-4 rounded-xl border border-slate-200 p-4">
    <h3 className="font-semibold">{language === "cn" ? "中文" : "English"}</h3>
    {readiness ? <div className="rounded-lg bg-emerald-50 px-3 py-2 text-[11px] text-emerald-950"><strong>{readiness.recommendable ? copy.recommend : readiness.browsable ? copy.browse : copy.draftStatus}</strong><p className="mt-1">{copy.browseMissing}: {missing(readiness.browse_missing)}</p><p>{copy.recommendMissing}: {missing(readiness.recommend_missing)}</p></div> : <p className="text-[11px] text-slate-500">{language === "cn" ? "保存后计算当前语言的完整度。" : "Save to calculate exact language readiness."}</p>}
    <label className="block text-xs font-medium text-slate-600">{copy.name}<input value={value("Name")} onChange={(event) => update("Name", event.target.value)} className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm" /></label>
    <label className="block text-xs font-medium text-slate-600">{copy.aliases}<input value={value("Aliases")} onChange={(event) => update("Aliases", event.target.value)} className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm" /></label>
    <label className="block text-xs font-medium text-slate-600">{copy.description}<textarea value={value("Description")} onChange={(event) => update("Description", event.target.value)} rows={3} className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm" /></label>
    <label className="block text-xs font-medium text-slate-600">{copy.sourceText}<textarea value={value("Source")} onChange={(event) => update("Source", event.target.value)} rows={2} className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm" /></label>
    <label className="block text-xs font-medium text-slate-600">{copy.tags}<input value={value("Tags")} onChange={(event) => update("Tags", event.target.value)} className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm" /></label>
    <label className="block text-xs font-medium text-slate-600">{copy.wiki}<input type="url" value={value("Wiki")} onChange={(event) => update("Wiki", event.target.value)} placeholder="https://…" className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm" /></label>
    <label className="block text-xs font-medium text-slate-600">{copy.trigger}<input value={value("Trigger")} onChange={(event) => update("Trigger", event.target.value)} className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm" /></label>
    <label className="block text-xs font-medium text-slate-600">{copy.avoid}<input value={value("Avoid")} onChange={(event) => update("Avoid", event.target.value)} className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm" /></label>
    <label className="block text-xs font-medium text-slate-600">{copy.transform}<input value={value("Transform")} onChange={(event) => update("Transform", event.target.value)} className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm" /></label>
    <label className="block text-xs font-medium text-slate-600">{copy.instruction}<textarea value={value("Instruction")} onChange={(event) => update("Instruction", event.target.value)} rows={3} className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm" /></label>
    <div className="text-xs font-medium text-slate-600">{copy.image}
      <div className="mt-2 rounded-lg border border-dashed border-slate-300 bg-slate-50 p-3">
        {images.length ? <div className="flex flex-wrap gap-2">{images.map((item, index) => <div key={item.kind === "existing" ? `${item.hash}-${index}` : item.id} className="flex items-center gap-2 rounded-md border border-slate-200 bg-white p-1.5"><img src={item.kind === "existing" ? `/api/assets/${item.hash}` : item.preview} alt={language === "cn" ? `中文图片 ${index + 1}` : `English image ${index + 1}`} className="h-14 w-20 rounded object-cover" /><span className="max-w-28 truncate text-[11px] text-slate-500">{item.kind === "new" ? item.fileName : `${language === "cn" ? "图片" : "Image"} ${index + 1}`}</span><button type="button" onClick={() => onRemoveImage(index)} aria-label={language === "cn" ? `移除第 ${index + 1} 张中文图片` : `Remove English image ${index + 1}`} className="rounded px-1.5 py-1 text-[11px] text-rose-700 hover:bg-rose-50">{copy.remove}</button></div>)}</div> : <p className="mb-2 text-xs text-slate-500">{copy.defaultImage}</p>}
        <input aria-label={language === "cn" ? "中文 WebP 图片" : "English WebP images"} type="file" accept="image/webp" multiple onChange={(event) => { onChooseImages(event.target.files ?? undefined); event.currentTarget.value = ""; }} className="mt-2 block w-full text-[11px] file:mr-2 file:rounded-md file:border-0 file:bg-white file:px-2 file:py-1" />
      </div>
    </div>
  </section>;
}
export default App;
