import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowRight, ArrowUpRight, Check, ChevronDown,
  Command, Compass, Globe2, Grid2X2, ImagePlus, LayoutDashboard, MoreHorizontal,
  List, Pencil, Plus, Search, Sparkles, Trash2, Upload, X,
} from "lucide-react";
import { Button } from "../components/ui/button";
import { Badge } from "../components/ui/badge";
import { Card } from "../components/ui/card";
import { Input } from "../components/ui/input";
import { Textarea } from "../components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "../components/ui/dialog";

type Locale = "cn" | "en";
type Variant = "A" | "B";
type Concept = {
  id: string; cnTitle: string; enTitle: string; cnDescription: string; enDescription: string;
  cnImage: string; enImage: string; wikiUrl: string; tags: string[]; notes: string; updatedAt: string; status: "Ready" | "Draft";
};
type ConceptDraft = Omit<Concept, "id" | "updatedAt" | "status">;

const seed: Concept[] = [
  { id: "co-101", cnTitle: "逆向思维", enTitle: "Inversion", cnDescription: "从想要的结果反向推演：先明确什么会导致失败，再主动避开它。", enDescription: "Work backward from the outcome. Identify what would cause failure, then avoid those conditions deliberately.", cnImage: "https://images.unsplash.com/photo-1518770660439-4636190af475?auto=format&fit=crop&w=900&q=85", enImage: "https://images.unsplash.com/photo-1518770660439-4636190af475?auto=format&fit=crop&w=900&q=85", wikiUrl: "https://en.wikipedia.org/wiki/Inversion", tags: ["决策", "风险", "思考工具"], notes: "Seed example · source detail still needs review.", updatedAt: "今天 09:42", status: "Ready" },
  { id: "co-102", cnTitle: "第一性原理", enTitle: "First Principles Thinking", cnDescription: "把问题拆解到不可再简化的基础事实，再从这些事实重新构建答案。", enDescription: "Break a problem down to its fundamental truths, then reason upward from those facts.", cnImage: "https://images.unsplash.com/photo-1451187580459-43490279c0fa?auto=format&fit=crop&w=900&q=85", enImage: "https://images.unsplash.com/photo-1451187580459-43490279c0fa?auto=format&fit=crop&w=900&q=85", wikiUrl: "", tags: ["分析", "创新"], notes: "Seed example.", updatedAt: "昨天 16:08", status: "Ready" },
  { id: "co-103", cnTitle: "安全边际", enTitle: "Margin of Safety", cnDescription: "在估值或决策中预留缓冲空间，以降低预测偏差和意外变化造成的损失。", enDescription: "Build a buffer between an estimate and a decision to reduce the impact of uncertainty and error.", cnImage: "https://images.unsplash.com/photo-1518546305927-5a555bb7020d?auto=format&fit=crop&w=900&q=85", enImage: "https://images.unsplash.com/photo-1518546305927-5a555bb7020d?auto=format&fit=crop&w=900&q=85", wikiUrl: "", tags: ["风险", "投资"], notes: "Seed example.", updatedAt: "Sep 18, 2026", status: "Ready" },
  { id: "co-104", cnTitle: "第二层思维", enTitle: "Second-Order Thinking", cnDescription: "继续追问一个决定带来的后续影响，避免只优化眼前结果。", enDescription: "Look beyond immediate effects and consider the consequences those effects create.", cnImage: "https://images.unsplash.com/photo-1470071459604-3b5ec3a7fe05?auto=format&fit=crop&w=900&q=85", enImage: "https://images.unsplash.com/photo-1470071459604-3b5ec3a7fe05?auto=format&fit=crop&w=900&q=85", wikiUrl: "", tags: ["决策", "系统思考"], notes: "Seed example.", updatedAt: "Sep 16, 2026", status: "Ready" },
  { id: "co-105", cnTitle: "古德哈特定律", enTitle: "Goodhart's Law", cnDescription: "当一个度量成为目标，它就不再是一个好的度量。", enDescription: "When a measure becomes a target, it ceases to be a good measure.", cnImage: "https://images.unsplash.com/photo-1509228468518-180dd4864904?auto=format&fit=crop&w=900&q=85", enImage: "https://images.unsplash.com/photo-1509228468518-180dd4864904?auto=format&fit=crop&w=900&q=85", wikiUrl: "", tags: ["度量", "系统"], notes: "Seed example.", updatedAt: "Sep 13, 2026", status: "Draft" },
  { id: "co-106", cnTitle: "可逆决策", enTitle: "One-Way and Two-Way Doors", cnDescription: "根据决策是否容易撤回，选择相应的审慎程度和推进速度。", enDescription: "Match the speed and rigor of a decision to how easily it can be reversed.", cnImage: "https://images.unsplash.com/photo-1497366811353-6870744d04b2?auto=format&fit=crop&w=900&q=85", enImage: "https://images.unsplash.com/photo-1497366811353-6870744d04b2?auto=format&fit=crop&w=900&q=85", wikiUrl: "", tags: ["决策", "执行"], notes: "Seed example.", updatedAt: "Sep 10, 2026", status: "Ready" },
];

const blankDraft: ConceptDraft = { cnTitle: "", enTitle: "", cnDescription: "", enDescription: "", cnImage: "", enImage: "", wikiUrl: "", tags: [], notes: "" };
const labels = {
  cn: { dashboard: "数据概览", concepts: "Concept 库", library: "知识库", new: "新建 Concept", all: "全部 Concept", search: "搜索名称、描述或标签…", dashboardTitle: "把好想法，变成可复用的工具。", dashboardSub: "这是你的 Concept 工作台。先从目录状态开始，再继续整理知识库。", viewAll: "查看全部 Concept", updated: "最近修订", language: "语言完整度", total: "Concept 总数", ready: "可推荐内容", collection: "目录概况", latest: "最近更新", view: "查看详情", edit: "编辑", remove: "删除", cardList: "卡片列表", tableList: "表格列表", tableTitle: "Concept", tableTags: "标签", tableStatus: "状态", tableUpdated: "最近更新", tableActions: "操作", draft: "草稿", readyLabel: "已就绪", allFilter: "全部状态", readyFilter: "已就绪", draftFilter: "草稿", noResults: "没有找到匹配内容。", sample: "示例数据 · 指标待定", demo: "临时 UI Demo", data: "内存模拟数据", catalog: "概念目录", overview: "工作台概览", save: "保存 Concept", create: "创建 Concept", cancel: "取消", title: "标题", description: "描述", image: "图片 URL", tags: "标签（逗号分隔）", wiki: "Wiki URL（可选）", notes: "备注", cn: "中文", en: "English", editTitle: "编辑 Concept", createTitle: "新建 Concept", deleted: "已从本次内存会话移除", saved: "已保存到内存状态", empty: "暂时还没有 Concept", languageReady: "语言内容齐备", recent: "最近修订", activity: "最近编辑", detail: "详情", selected: "已选中", filters: "筛选", allTags: "全部标签", close: "关闭", count: "条目", incomplete: "资料待补充", full: "内容齐备", state: "状态快照", noImage: "暂无图片", clear: "清空筛选", result: "搜索结果", waiting: "等待补齐中英文完整度"
  },
  en: { dashboard: "Dashboard", concepts: "Concepts", library: "Library", new: "New Concept", all: "All concepts", search: "Search name, description, tags…", dashboardTitle: "Turn good ideas into reusable tools.", dashboardSub: "Your Concept workspace. Start with catalog readiness and keep shaping your library.", viewAll: "View all concepts", updated: "Recently revised", language: "Language readiness", total: "Total Concepts", ready: "Recommendation ready", collection: "Catalog overview", latest: "Latest changes", view: "View details", edit: "Edit", remove: "Delete", cardList: "Card list", tableList: "Table list", tableTitle: "Concept", tableTags: "Tags", tableStatus: "Status", tableUpdated: "Updated", tableActions: "Actions", draft: "Draft", readyLabel: "Ready", allFilter: "All status", readyFilter: "Ready", draftFilter: "Draft", noResults: "No matching concepts found.", sample: "Sample data · metrics pending", demo: "Temporary UI Demo", data: "In-memory sample data", catalog: "Concept Catalog", overview: "Workspace overview", save: "Save Concept", create: "Create Concept", cancel: "Cancel", title: "Title", description: "Description", image: "Image URL", tags: "Tags (comma-separated)", wiki: "Wiki URL (optional)", notes: "Notes", cn: "中文", en: "English", editTitle: "Edit Concept", createTitle: "New Concept", deleted: "Removed from this in-memory session", saved: "Saved to in-memory state", empty: "No concepts yet", languageReady: "Language completeness", recent: "Recent revisions", activity: "Recent edits", detail: "Detail", selected: "Selected", filters: "Filters", allTags: "All tags", close: "Close", count: "items", incomplete: "Needs content", full: "Complete", state: "State snapshot", noImage: "No image", clear: "Clear filters", result: "Search results", waiting: "Waiting for bilingual content"
  }
};

const variantInfo: Record<Variant, string> = { A: "Dashboard first", B: "Card First" };
function readVariant(): Variant {
  const v = new URLSearchParams(window.location.search).get("variant");
  return v === "B" ? "B" : "A";
}

function useVariant() {
  const [variant, setVariant] = useState<Variant>(readVariant);
  useEffect(() => {
    const normalizeAndRead = () => {
      const url = new URL(window.location.href);
      if (url.searchParams.get("variant") === "C") {
        url.searchParams.set("variant", "A");
        window.history.replaceState({}, "", url);
      }
      setVariant(readVariant());
    };
    normalizeAndRead();
    const onPop = () => normalizeAndRead();
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  const change = (next: Variant) => {
    const url = new URL(window.location.href);
    url.searchParams.set("variant", next);
    window.history.pushState({}, "", url);
    setVariant(next);
  };
  return [variant, change] as const;
}

function App() {
  const [variant, setVariant] = useVariant();
  const [locale, setLocale] = useState<Locale>("cn");
  const [concepts, setConcepts] = useState(seed);
  const [page, setPage] = useState<"dashboard" | "concepts">(variant === "A" ? "dashboard" : "concepts");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [tagFilter, setTagFilter] = useState("all");
  const [selectedId, setSelectedId] = useState(seed[0].id);
  const [formOpen, setFormOpen] = useState(false);
  const [formSource, setFormSource] = useState<Concept | null>(null);
  const [notice, setNotice] = useState("");
  const [showState, setShowState] = useState(false);
  const t = labels[locale];
  useEffect(() => { setPage(variant === "B" ? "concepts" : "dashboard"); }, [variant]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const node = event.target as HTMLElement | null;
      if (node?.matches("input, textarea, [contenteditable='true']")) return;
      if (event.key === "ArrowLeft" || event.key === "ArrowRight") setVariant(variant === "A" ? "B" : "A");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [variant, setVariant]);
  useEffect(() => { if (!notice) return; const id = window.setTimeout(() => setNotice(""), 2600); return () => window.clearTimeout(id); }, [notice]);

  const filtered = useMemo(() => concepts.filter((c) => {
    const text = `${c.cnTitle} ${c.enTitle} ${c.cnDescription} ${c.enDescription} ${c.tags.join(" ")}`.toLowerCase();
    return (!search || text.includes(search.toLowerCase())) && (statusFilter === "all" || c.status.toLowerCase() === statusFilter) && (tagFilter === "all" || c.tags.includes(tagFilter));
  }), [concepts, search, statusFilter, tagFilter]);
  const allTags = Array.from(new Set(concepts.flatMap((c) => c.tags)));
  const fullCn = concepts.filter((c) => c.cnTitle && c.cnDescription && c.cnImage).length;
  const fullEn = concepts.filter((c) => c.enTitle && c.enDescription && c.enImage).length;

  const openCreate = () => { setFormSource(null); setFormOpen(true); };
  const openEdit = (concept: Concept) => { setFormSource(concept); setFormOpen(true); };
  const saveConcept = (draft: ConceptDraft) => {
    const now = new Intl.DateTimeFormat(locale === "cn" ? "zh-CN" : "en", { hour: "2-digit", minute: "2-digit" }).format(new Date());
    if (formSource) {
      setConcepts((current) => current.map((c) => c.id === formSource.id ? { ...c, ...draft, updatedAt: `${locale === "cn" ? "今天" : "Today"} ${now}` } : c));
      setSelectedId(formSource.id);
      setNotice(t.saved);
    } else {
      const id = `co-${Math.floor(100 + Math.random() * 900)}`;
      const created = { ...draft, id, updatedAt: `${locale === "cn" ? "今天" : "Today"} ${now}`, status: "Draft" as const };
      setConcepts((current) => [created, ...current]); setSelectedId(id); setNotice(t.saved); setPage("concepts");
    }
    setFormOpen(false);
  };
  const removeConcept = (concept: Concept) => {
    setConcepts((current) => current.filter((c) => c.id !== concept.id));
    setSelectedId((current) => current === concept.id ? (concepts.find((c) => c.id !== concept.id)?.id ?? "") : current);
    setNotice(t.deleted);
  };

  const goTo = (next: "dashboard" | "concepts") => setPage(next);

  return <div className="fixed inset-0 flex flex-col overflow-hidden bg-canvas text-ink">
    <header className="fixed inset-x-0 top-0 z-30 flex h-[68px] items-center justify-between border-b border-line bg-white/95 px-6 backdrop-blur xl:px-10">
      <div className="flex items-center gap-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-accent-soft text-brand"><Compass size={19} strokeWidth={2.4} /></div>
        <div><div className="text-[14px] font-semibold tracking-tight">Concept Discovery</div><div className="text-[10px] font-medium uppercase tracking-[.14em] text-muted">Local Workspace</div></div>
        <div className="ml-2 hidden h-7 items-center gap-1.5 rounded-full border border-amber-200 bg-amber-50 px-2.5 text-[10px] font-semibold uppercase tracking-wide text-amber-800 sm:flex"><span className="h-1.5 w-1.5 rounded-full bg-amber-500" />{t.demo}</div>
      </div>
      <div className="flex items-center gap-2 sm:gap-3">
        <div className="hidden items-center gap-1 rounded-lg border border-line bg-slate-50 p-1 md:flex"><button className={`rounded-md px-2.5 py-1 text-xs ${locale === "cn" ? "bg-white text-ink shadow-sm" : "text-muted"}`} onClick={() => setLocale("cn")}>中</button><button className={`rounded-md px-2.5 py-1 text-xs ${locale === "en" ? "bg-white text-ink shadow-sm" : "text-muted"}`} onClick={() => setLocale("en")}>EN</button></div>
        <div className="hidden h-8 items-center gap-1.5 rounded-full border border-line px-2.5 text-[11px] text-muted lg:flex"><span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />{t.data}</div>
      </div>
    </header>
    <div aria-hidden="true" className="h-[68px] shrink-0" />

    <div className="mobile-navigation relative z-20 flex shrink-0 items-center justify-between border-b border-line bg-white px-4 py-2 xl:hidden"><nav className="flex gap-1"><button onClick={() => goTo("dashboard")} className={`min-h-11 rounded-lg px-3 text-sm ${page === "dashboard" ? "bg-accent-soft font-medium text-brand" : "text-muted"}`}><LayoutDashboard size={14} className="mr-1.5 inline" />{t.dashboard}</button><button onClick={() => goTo("concepts")} className={`min-h-11 rounded-lg px-3 text-sm ${page === "concepts" ? "bg-accent-soft font-medium text-brand" : "text-muted"}`}><Grid2X2 size={14} className="mr-1.5 inline" />{t.concepts}</button></nav><div className="flex items-center gap-1 rounded-lg bg-slate-50 p-1"><button className={`min-h-9 rounded-md px-2 text-xs ${locale === "cn" ? "bg-white shadow-sm" : "text-muted"}`} onClick={() => setLocale("cn")}>中</button><button className={`min-h-9 rounded-md px-2 text-xs ${locale === "en" ? "bg-white shadow-sm" : "text-muted"}`} onClick={() => setLocale("en")}>EN</button></div></div>

    <div className="flex min-h-0 flex-1 overflow-hidden">
      <aside className="desktop-sidebar hidden h-full max-h-[calc(100dvh-68px)] min-h-0 w-[228px] shrink-0 overflow-y-auto border-r border-line bg-white px-4 py-7 xl:block">
        <p className="mb-3 px-3 text-[10px] font-semibold uppercase tracking-[.16em] text-slate-400">Workspace</p>
        <nav className="space-y-1">
          <NavItem icon={<LayoutDashboard size={17} />} active={page === "dashboard"} onClick={() => goTo("dashboard")}>{t.dashboard}</NavItem>
          <NavItem icon={<Grid2X2 size={17} />} active={page === "concepts"} onClick={() => goTo("concepts")}>{t.concepts}<span className="ml-auto rounded-md bg-slate-100 px-1.5 py-0.5 text-[10px] text-muted">{concepts.length}</span></NavItem>
        </nav>
      </aside>
      <main className="min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto">
        {page === "dashboard" ? <Dashboard {...{ t, concepts, fullCn, fullEn, goTo, openCreate, setSelectedId, setLocale }} /> : <ConceptsPage {...{ t, locale, concepts, filtered, selectedId, setSelectedId, search, setSearch, statusFilter, setStatusFilter, tagFilter, setTagFilter, allTags, openCreate, openEdit, removeConcept }} />}
      </main>
    </div>

    <Dialog open={formOpen} onOpenChange={setFormOpen}>
      <DialogContent>
        <ConceptForm key={formSource?.id ?? "new"} initial={formSource ?? blankDraft} editing={!!formSource} t={t} onCancel={() => setFormOpen(false)} onSave={saveConcept} />
      </DialogContent>
    </Dialog>

    {notice && <div className="fixed right-5 top-[82px] z-[70] flex items-center gap-2 rounded-xl border border-emerald-200 bg-white px-4 py-3 text-sm shadow-lg"><span className="flex h-6 w-6 items-center justify-center rounded-full bg-emerald-50 text-emerald-700"><Check size={14} /></span>{notice}</div>}

    {import.meta.env.DEV && <>
      <div className="fixed bottom-5 left-1/2 z-40 flex -translate-x-1/2 items-center gap-1 rounded-2xl border border-slate-700/10 bg-surface-inverse p-1.5 text-white shadow-switcher">
        {(["A", "B"] as Variant[]).map((v) => <button key={v} onClick={() => setVariant(v)} className={`rounded-lg px-2.5 py-2 text-[11px] font-semibold transition ${variant === v ? "bg-white text-ink" : "text-white/70 hover:bg-white/10 hover:text-white"}`}>{v}<span className="ml-1.5 hidden text-[10px] font-normal min-[900px]:inline">{variantInfo[v]}</span></button>)}
        <div className="mx-1 h-5 w-px bg-white/15" />
        <button onClick={() => setShowState((v) => !v)} className="flex items-center gap-1.5 rounded-lg px-2 py-2 text-[10px] text-white/70 hover:bg-white/10"><Command size={12} />{t.state}</button>
      </div>
      {showState && <div className="fixed bottom-[76px] left-1/2 z-40 w-[min(620px,calc(100vw-24px))] -translate-x-1/2 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl"><div className="flex items-center justify-between border-b border-line px-4 py-3"><div><div className="text-xs font-semibold">In-memory Concept state</div><div className="text-[10px] text-muted">{concepts.length} records · reload to reset</div></div><button onClick={() => setShowState(false)} className="rounded-md p-1 text-muted hover:bg-slate-100"><X size={15} /></button></div><pre className="scroll-thin max-h-[34vh] overflow-auto bg-slate-50 p-4 text-[10px] leading-5 text-slate-600">{JSON.stringify(concepts, null, 2)}</pre></div>}
    </>}
  </div>;
}

export default App;

function NavItem({ icon, active, onClick, children }: { icon: React.ReactNode; active: boolean; onClick: () => void; children: React.ReactNode }) {
  return <button aria-current={active ? "page" : undefined} onClick={onClick} className={`flex min-h-11 w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm transition ${active ? "bg-accent-soft font-medium text-brand" : "text-slate-500 hover:bg-slate-50 hover:text-ink"}`}>{icon}{children}</button>;
}

function Dashboard({ t, concepts, fullCn, fullEn, goTo, openCreate, setSelectedId, setLocale }: { t: typeof labels.cn; concepts: Concept[]; fullCn: number; fullEn: number; goTo: (page: "dashboard" | "concepts") => void; openCreate: () => void; setSelectedId: (id: string) => void; setLocale: (locale: Locale) => void }) {
  const recent = concepts.slice(0, 4);
  return <div className="page-enter mx-auto max-w-[1440px] px-6 py-9 pb-28 xl:px-10">
    <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
      <div><div className="mb-2 flex items-center gap-2 text-[11px] font-medium text-muted"><span>{t.overview}</span><span>/</span><span className="text-brand">{t.dashboard}</span></div><h1 className="max-w-2xl text-[28px] font-semibold leading-tight tracking-[-.035em] md:text-[32px]">{t.dashboardTitle}</h1><p className="mt-2 text-[15px] leading-[1.75] tracking-[.02em] text-muted">{t.dashboardSub}</p></div>
      <div className="flex gap-2"><Button variant="secondary" onClick={openCreate}><Plus size={15} />{t.new}</Button><Button onClick={() => goTo("concepts")}>{t.viewAll}<ArrowUpRight size={15} /></Button></div>
    </div>
    <div className="mb-4"><span className="rounded-full bg-amber-100 px-2.5 py-1 text-[10px] font-medium text-amber-800">{t.sample}</span></div>
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <MetricCard label={t.total} value={concepts.length.toString().padStart(2, "0")} caption="Across both locales" icon={<Grid2X2 size={17} />} delta="+2 this month" />
      <MetricCard label="中文 · 完整度" value={`${concepts.length ? Math.round(fullCn / concepts.length * 100) : 0}%`} caption={`${fullCn} of ${concepts.length} have image + copy`} icon={<Globe2 size={17} />} delta={`${fullCn} ${t.count}`} />
      <MetricCard label="English · Readiness" value={`${concepts.length ? Math.round(fullEn / concepts.length * 100) : 0}%`} caption={`${fullEn} of ${concepts.length} have image + copy`} icon={<Globe2 size={17} />} delta={`${fullEn} ${t.count}`} />
      <MetricCard label={t.ready} value={concepts.filter((c) => c.status === "Ready").length.toString().padStart(2, "0")} caption={t.waiting} icon={<Sparkles size={17} />} delta="Pending definition" />
    </div>
    <div className="mt-6 grid gap-5 xl:grid-cols-[1.3fr_.7fr]">
      <Card className="overflow-hidden"><div className="flex items-center justify-between border-b border-line px-5 py-4"><div><h2 className="text-sm font-semibold">{t.language}</h2><p className="mt-1 text-[11px] text-muted">{t.sample}</p></div><Badge variant="outline"><Globe2 size={12} className="mr-1" />cn / en</Badge></div><div className="grid divide-y divide-line sm:grid-cols-2 sm:divide-x sm:divide-y-0">
        <ReadinessCard name="中文内容" lang="cn" full={fullCn} total={concepts.length} onClick={() => { setLocale("cn"); goTo("concepts"); }} />
        <ReadinessCard name="English content" lang="en" full={fullEn} total={concepts.length} onClick={() => { setLocale("en"); goTo("concepts"); }} />
      </div></Card>
      <Card><div className="flex items-center justify-between border-b border-line px-5 py-4"><div><h2 className="text-sm font-semibold">{t.updated}</h2><p className="mt-1 text-[11px] text-muted">Revision feed · sample</p></div><button className="text-xs font-medium text-brand" onClick={() => goTo("concepts")}>{t.viewAll}</button></div><div className="px-5 py-1">{recent.map((c, index) => <button key={c.id} onClick={() => { setSelectedId(c.id); goTo("concepts"); }} className="flex w-full items-center gap-3 border-b border-line py-3.5 text-left last:border-0"><div className={`flex h-8 w-8 items-center justify-center rounded-full ${index === 0 ? "bg-accent-soft text-brand" : "bg-slate-100 text-slate-500"}`}><Pencil size={13} /></div><div className="min-w-0 flex-1"><div className="truncate text-xs font-medium">{c.cnTitle}</div><div className="mt-1 text-[10px] text-muted">{t.edit} · {c.updatedAt}</div></div><ArrowUpRight size={14} className="text-slate-400" /></button>)}</div></Card>
    </div>
  </div>;
}

function MetricCard({ label, value, caption, icon, delta }: { label: string; value: string; caption: string; icon: React.ReactNode; delta: string }) {
  return <Card className="p-5"><div className="mb-4 flex items-center justify-between"><span className="text-[11px] font-medium text-muted">{label}</span><span className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent-soft text-brand">{icon}</span></div><div className="flex items-end justify-between"><div><div className="text-[30px] font-semibold leading-none tracking-[-.04em]">{value}</div><p className="mt-2 text-xs text-muted">{caption}</p></div><span className="text-[10px] text-slate-400">{delta}</span></div></Card>;
}

function ReadinessCard({ name, lang, full, total, onClick }: { name: string; lang: Locale; full: number; total: number; onClick: () => void }) {
  const value = total ? Math.round(full / total * 100) : 0;
  return <button onClick={onClick} className="p-5 text-left transition hover:bg-slate-50"><div className="mb-3 flex items-center justify-between"><div className="flex items-center gap-2"><span className="flex h-6 min-w-6 items-center justify-center rounded-md bg-slate-100 px-1 text-[10px] font-semibold text-slate-600">{lang.toUpperCase()}</span><span className="text-xs font-medium">{name}</span></div><span className="text-xs font-semibold">{value}%</span></div><div className="h-2 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-brand transition-all" style={{ width: `${value}%` }} /></div><div className="mt-2 flex justify-between text-[10px] text-muted"><span>{full} / {total} {lang === "cn" ? "条目齐备" : "complete entries"}</span><span>View <ArrowRight className="ml-1 inline" size={11} /></span></div></button>;
}

type ListingProps = {
  t: typeof labels.cn; locale: Locale; concepts: Concept[]; filtered: Concept[]; selectedId: string; setSelectedId: (id: string) => void;
  search: string; setSearch: (s: string) => void; statusFilter: string; setStatusFilter: (s: string) => void; tagFilter: string; setTagFilter: (s: string) => void;
  allTags: string[]; openCreate: () => void; openEdit: (c: Concept) => void; removeConcept: (c: Concept) => void;
};

function ConceptsPage(props: ListingProps) {
  const { t, locale, filtered, concepts, selectedId, setSelectedId, search, setSearch, statusFilter, setStatusFilter, tagFilter, setTagFilter, allTags, openCreate, openEdit, removeConcept } = props;
  const [viewMode, setViewMode] = useState<"cards" | "table">("cards");
  return <div className="page-enter mx-auto max-w-[1440px] px-6 py-9 pb-28 xl:px-10">
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4"><div><div className="mb-2 text-[11px] font-medium text-muted">Workspace / {t.library}</div><h1 className="text-[30px] font-semibold tracking-[-.035em]">{t.all}</h1></div><Button onClick={openCreate}><Plus size={16} />{t.new}</Button></div>
    <div className="sticky top-0 z-20 -mx-6 mb-5 border-y border-line bg-canvas/95 px-6 py-3 backdrop-blur xl:-mx-10 xl:px-10">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[220px] flex-1 sm:max-w-[380px]"><Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} /><Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t.search} className="pl-9" /></div>
        <FilterSelect value={statusFilter} onChange={setStatusFilter} options={[["all", t.allFilter], ["ready", t.readyFilter], ["draft", t.draftFilter]]} />
        <FilterSelect value={tagFilter} onChange={setTagFilter} options={[["all", t.allTags], ...allTags.map((tag) => [tag, tag] as [string, string])]} />
        <span className="ml-auto whitespace-nowrap text-[11px] text-muted">{filtered.length} / {concepts.length} {t.count}</span>
        <div role="group" aria-label={locale === "cn" ? "Concept 显示方式" : "Concept view"} className="flex shrink-0 items-center rounded-lg border border-line bg-white p-1">
          <button type="button" aria-pressed={viewMode === "cards"} onClick={() => setViewMode("cards")} className={`flex h-8 items-center gap-1.5 rounded-md px-2.5 text-xs transition ${viewMode === "cards" ? "bg-accent-soft font-medium text-brand" : "text-muted hover:text-ink"}`}><Grid2X2 size={14} />{t.cardList}</button>
          <button type="button" aria-pressed={viewMode === "table"} onClick={() => setViewMode("table")} className={`flex h-8 items-center gap-1.5 rounded-md px-2.5 text-xs transition ${viewMode === "table" ? "bg-accent-soft font-medium text-brand" : "text-muted hover:text-ink"}`}><List size={15} />{t.tableList}</button>
        </div>
      </div>
    </div>
    <div id="concept-results" role="tabpanel" className="min-h-[240px]">
      {filtered.length ? viewMode === "cards" ? <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">{filtered.map((c) => <ConceptCard key={c.id} concept={c} locale={locale} t={t} selected={c.id === selectedId} onSelect={() => setSelectedId(c.id)} onEdit={() => openEdit(c)} onDelete={() => removeConcept(c)} />)}</div> : <div className="overflow-x-auto rounded-xl border border-line bg-white"><table className="w-full min-w-[700px] table-fixed border-collapse text-left lg:min-w-[900px]"><colgroup><col className="w-[49%] lg:w-[42%]" /><col className="w-[23%] lg:w-[19%]" /><col className="w-[14%] lg:w-[11%]" /><col className="hidden w-[16%] lg:table-column" /><col className="w-[14%] lg:w-[12%]" /></colgroup><thead className="bg-slate-50 text-[10px] font-semibold uppercase tracking-[.08em] text-muted"><tr><th className="whitespace-nowrap px-4 py-3">{t.tableTitle}</th><th className="whitespace-nowrap px-4 py-3">{t.tableTags}</th><th className="whitespace-nowrap px-4 py-3">{t.tableStatus}</th><th className="hidden whitespace-nowrap px-4 py-3 lg:table-cell">{t.tableUpdated}</th><th className="whitespace-nowrap px-4 py-3 text-right">{t.tableActions}</th></tr></thead><tbody>{filtered.map((c) => { const title = locale === "cn" ? c.cnTitle || c.enTitle : c.enTitle || c.cnTitle; const secondaryTitle = locale === "cn" ? c.enTitle : c.cnTitle; const description = locale === "cn" ? c.cnDescription || c.enDescription : c.enDescription || c.cnDescription; return <tr key={c.id} className={`border-t border-line transition-colors hover:bg-slate-50 ${selectedId === c.id ? "bg-accent-soft/50" : ""}`}>
        <td className="px-4 py-3"><button type="button" onClick={() => setSelectedId(c.id)} className="flex max-w-[380px] items-center gap-3 text-left"><div className="h-10 w-10 shrink-0 overflow-hidden rounded-lg bg-slate-100"><img src={locale === "cn" ? c.cnImage : c.enImage} alt="" onError={(e) => { e.currentTarget.style.display = "none"; }} className="h-full w-full object-cover" /></div><span className="min-w-0"><span className="block truncate text-sm font-medium text-ink">{title}</span><span className="block truncate text-[11px] text-muted">{secondaryTitle} · {description}</span></span></button></td>
        <td className="overflow-hidden px-4 py-3"><div className="flex max-w-[220px] flex-nowrap gap-1 overflow-hidden">{c.tags.slice(0, 2).map((tag) => <Badge key={tag} variant="outline" className="shrink-0 px-2 py-0.5 text-[9px]">{tag}</Badge>)}{c.tags.length > 2 && <span className="shrink-0 text-[10px] text-muted">+{c.tags.length - 2}</span>}</div></td>
        <td className="whitespace-nowrap px-4 py-3"><Badge variant={c.status === "Ready" ? "soft" : "outline"}>{c.status === "Ready" ? t.readyLabel : t.draft}</Badge></td>
        <td className="hidden whitespace-nowrap px-4 py-3 text-xs text-muted lg:table-cell">{c.updatedAt}</td>
        <td className="px-4 py-3"><div className="flex justify-end gap-1"><Button type="button" variant="ghost" size="icon" aria-label={`${t.edit} ${title}`} onClick={() => openEdit(c)}><Pencil size={14} /></Button><Button type="button" variant="ghost" size="icon" aria-label={`${t.remove} ${title}`} onClick={() => removeConcept(c)}><Trash2 size={14} /></Button></div></td>
      </tr>; })}</tbody></table></div> : <EmptyState t={t} onClear={() => { setSearch(""); setStatusFilter("all"); setTagFilter("all"); }} />}
    </div>
  </div>;
}

function ConceptCard({ concept, locale, t, selected, onSelect, onEdit, onDelete }: { concept: Concept; locale: Locale; t: typeof labels.cn; selected: boolean; onSelect: () => void; onEdit: () => void; onDelete: () => void }) {
  const title = (locale === "cn" ? concept.cnTitle : concept.enTitle) || concept.cnTitle || concept.enTitle;
  const desc = (locale === "cn" ? concept.cnDescription : concept.enDescription) || concept.cnDescription || concept.enDescription;
  const image = locale === "cn" ? concept.cnImage : concept.enImage;
  return <Card className={`group overflow-hidden transition duration-200 hover:border-slate-300 hover:shadow-panel-hover ${selected ? "ring-1 ring-brand/30" : ""}`}>
    <button onClick={onSelect} className="relative block h-[168px] w-full overflow-hidden bg-surface-alt image-placeholder text-left"><img src={image} onError={(e) => { e.currentTarget.style.display = "none"; }} className="absolute inset-0 h-full w-full object-cover transition duration-500 group-hover:scale-[1.025]" /><div className="absolute inset-0 bg-gradient-to-t from-slate-950/45 via-transparent to-transparent" /><div className="absolute bottom-3.5 left-4 right-4 flex items-end justify-between"><Badge variant="soft" className="bg-white/90 text-brand">{concept.status === "Ready" ? t.readyLabel : t.draft}</Badge><span className="flex h-8 w-8 items-center justify-center rounded-full bg-white/90 text-slate-700"><ArrowUpRight size={15} /></span></div></button>
    <div className="p-4"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><div className="truncate text-[16px] font-semibold tracking-tight">{title}</div><div className="mt-1 truncate text-[10px] font-medium uppercase tracking-[.09em] text-slate-400">{locale === "cn" ? concept.enTitle : concept.cnTitle}</div></div><button onClick={onEdit} aria-label={t.edit} className="rounded-md p-2 text-slate-400 opacity-100 hover:bg-slate-100 hover:text-ink sm:opacity-0 sm:group-hover:opacity-100"><MoreHorizontal size={17} /></button></div><p className="mt-3 line-clamp-2 min-h-[42px] text-[15px] leading-[1.75] text-muted">{desc}</p><div className="mt-3 flex flex-wrap gap-1.5">{concept.tags.map((tag) => <Badge key={tag} variant="outline" className="px-2 py-0.5 text-[11px]">{tag}</Badge>)}</div><div className="mt-4 flex items-center justify-between border-t border-line pt-3"><span className="text-[10px] text-slate-400">{t.updated} · {concept.updatedAt}</span><div className="flex items-center gap-1"><button onClick={onEdit} className="rounded-md px-2 py-1 text-[10px] font-medium text-muted hover:bg-slate-100 hover:text-ink"><Pencil size={11} className="mr-1 inline" />{t.edit}</button><button onClick={onDelete} className="rounded-md p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600" aria-label="Delete"><Trash2 size={13} /></button></div></div></div>
  </Card>;
}

function FilterSelect({ value, onChange, options }: { value: string; onChange: (value: string) => void; options: [string, string][] }) {
  return <div className="relative"><select value={value} onChange={(e) => onChange(e.target.value)} className="h-10 appearance-none rounded-lg border border-line bg-white py-2 pl-3 pr-8 text-xs text-slate-600 outline-none focus:ring-2 focus:ring-brand/10">{options.map(([v, label]) => <option key={v} value={v}>{label}</option>)}</select><ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400" size={14} /></div>;
}

function EmptyState({ t, onClear }: { t: typeof labels.cn; onClear: () => void }) {
  return <div className="flex min-h-[300px] flex-col items-center justify-center rounded-2xl border border-dashed border-slate-300 bg-white/60 px-5 text-center"><div className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-100 text-slate-400"><Search size={19} /></div><h3 className="text-sm font-semibold">{t.noResults}</h3><p className="mt-1.5 text-xs text-muted">Adjust your search or remove a filter.</p><Button variant="outline" size="sm" onClick={onClear} className="mt-4">{t.clear}</Button></div>;
}

function ConceptForm({ initial, editing, t, onCancel, onSave }: { initial: Concept | ConceptDraft; editing: boolean; t: typeof labels.cn; onCancel: () => void; onSave: (draft: ConceptDraft) => void }) {
  const [draft, setDraft] = useState<ConceptDraft>({ cnTitle: initial.cnTitle, enTitle: initial.enTitle, cnDescription: initial.cnDescription, enDescription: initial.enDescription, cnImage: initial.cnImage, enImage: initial.enImage, wikiUrl: initial.wikiUrl, tags: [...initial.tags], notes: initial.notes });
  const [pendingUploads, setPendingUploads] = useState(0);
  const update = <K extends keyof ConceptDraft>(key: K, value: ConceptDraft[K]) => setDraft((current) => ({ ...current, [key]: value }));
  const field = (key: keyof ConceptDraft, label: string, placeholder: string) => <label className="block"><span className="mb-1.5 block text-[11px] font-medium text-slate-600">{label}</span><Input value={typeof draft[key] === "string" ? draft[key] as string : ""} onChange={(e) => update(key, e.target.value as never)} placeholder={placeholder} /></label>;
  return <form onSubmit={(e) => { e.preventDefault(); onSave(draft); }} className="flex max-h-[calc(100dvh-24px)] flex-col">
    <div className="shrink-0 border-b border-line px-5 py-3.5 pr-14"><div className="mb-0.5 text-[10px] font-semibold uppercase tracking-[.14em] text-brand">{editing ? "Update record" : "Add to your library"}</div><DialogTitle className="text-lg font-semibold tracking-tight">{editing ? t.editTitle : t.createTitle}</DialogTitle><DialogDescription className="mt-0.5 text-xs text-muted">Both language versions are edited independently. Changes stay in memory.</DialogDescription></div>
    <div className="dialog-form-scroll min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
      <div className="grid gap-4 min-[700px]:grid-cols-2 min-[700px]:gap-5">
        <section className="space-y-2.5"><div className="flex items-center gap-2 text-xs font-semibold"><span className="flex h-5 w-5 items-center justify-center rounded-full bg-accent-soft text-[10px] text-brand">中</span>中文内容</div>{field("cnTitle", "中文标题", "例如：逆向思维")}<label className="block"><span className="mb-1 block text-[11px] font-medium text-slate-600">中文描述</span><Textarea className="h-24 min-h-24 resize-y py-2" rows={3} value={draft.cnDescription} onChange={(e) => update("cnDescription", e.target.value)} placeholder="用一两句话说明这个 Concept…" /></label><ImageUpload label="中文图片" value={draft.cnImage} onChange={(value) => update("cnImage", value)} onBusyChange={(busy) => setPendingUploads((current) => Math.max(0, current + (busy ? 1 : -1)))} /></section>
        <section className="space-y-2.5 min-[700px]:border-l min-[700px]:border-line min-[700px]:pl-5"><div className="flex items-center gap-2 text-xs font-semibold"><span className="flex h-5 w-5 items-center justify-center rounded-full bg-slate-100 text-[9px] text-slate-600">EN</span>English content</div>{field("enTitle", "English title", "e.g. Inversion")}<label className="block"><span className="mb-1 block text-[11px] font-medium text-slate-600">English description</span><Textarea className="h-24 min-h-24 resize-y py-2" rows={3} value={draft.enDescription} onChange={(e) => update("enDescription", e.target.value)} placeholder="Describe the concept in one or two sentences…" /></label><ImageUpload label="English image" value={draft.enImage} onChange={(value) => update("enImage", value)} onBusyChange={(busy) => setPendingUploads((current) => Math.max(0, current + (busy ? 1 : -1)))} /></section>
      </div>
      <div className="grid gap-3 border-t border-line pt-3 min-[700px]:grid-cols-2">{field("wikiUrl", t.wiki, "https://en.wikipedia.org/wiki/…")}<label className="block"><span className="mb-1.5 block text-[11px] font-medium text-slate-600">{t.tags}</span><Input value={draft.tags.join(", ")} onChange={(e) => update("tags", e.target.value.split(",").map((x) => x.trim()).filter(Boolean))} placeholder="Decision, Systems thinking" /></label><label className="block min-[700px]:col-span-2"><span className="mb-1 block text-[11px] font-medium text-slate-600">{t.notes}</span><Textarea className="h-[64px] min-h-[64px] resize-y py-2" rows={2} value={draft.notes} onChange={(e) => update("notes", e.target.value)} placeholder="Internal notes for this record…" /></label></div>
    </div>
    <div className="flex shrink-0 items-center justify-between border-t border-line bg-slate-50/70 px-5 py-3"><span className="text-[10px] text-muted"><span className="mr-1.5 inline-block h-1.5 w-1.5 rounded-full bg-emerald-500" />Memory only · resets on reload</span><div className="flex gap-2"><Button type="button" variant="secondary" onClick={onCancel}>{t.cancel}</Button><Button type="submit" disabled={pendingUploads > 0}><Check size={14} />{editing ? t.save : t.create}</Button></div></div>
  </form>;
}

function ImageUpload({ label, value, onChange, onBusyChange }: { label: string; value: string; onChange: (value: string) => void; onBusyChange: (busy: boolean) => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState("");
  const [fileName, setFileName] = useState("");
  const [uploading, setUploading] = useState(false);
  const acceptFile = (file?: File) => {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setError("请选择图片文件 / Choose an image file");
      return;
    }
    if (file.size > 8 * 1024 * 1024) {
      setError("图片需小于 8 MB / Keep image under 8 MB");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        onChange(reader.result);
        setFileName(file.name);
        setError("");
      } else setError("图片读取失败，请重试 / Could not read image");
      setUploading(false);
      onBusyChange(false);
    };
    reader.onerror = () => { setError("图片读取失败，请重试 / Could not read image"); setUploading(false); onBusyChange(false); };
    setUploading(true);
    onBusyChange(true);
    reader.readAsDataURL(file);
  };
  return <div>
    <div className="mb-1 flex items-center justify-between"><span className="text-[11px] font-medium text-slate-600">{label}</span><span className="text-[10px] text-muted">PNG · JPG · WebP · Max 8 MB</span></div>
    <div onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); acceptFile(event.dataTransfer.files[0]); }} className="flex min-h-[76px] items-center gap-3 rounded-lg border border-dashed border-border-strong bg-surface-subtle px-3 py-2">
      {value ? <img src={value} alt={`${label} preview`} className="h-14 w-[76px] shrink-0 rounded-md border border-line bg-white object-cover" /> : <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-white text-brand"><ImagePlus size={20} /></span>}
      <div className="min-w-0 flex-1"><div title={fileName || undefined} className="truncate text-xs font-medium text-ink">{uploading ? "正在读取图片… / Reading…" : fileName || (value ? "图片预览已就绪 / Image ready" : "拖入图片，或点击上传")}</div><div className="mt-1 text-[10px] text-muted">{value ? "仅本会话可见 · Local preview" : "图片仅保存在当前会话内存"}</div></div>
      <button type="button" disabled={uploading} onClick={() => inputRef.current?.click()} aria-label={`${value ? "更换" : "上传"} ${label}`} className="inline-flex min-h-9 shrink-0 items-center gap-1.5 rounded-md border border-line bg-white px-2.5 text-[11px] font-medium text-ink transition hover:bg-slate-50 disabled:cursor-wait disabled:opacity-60"><Upload size={13} />{value ? "更换" : "上传"}</button>
      <input ref={inputRef} type="file" accept="image/*" className="sr-only" onChange={(event) => { acceptFile(event.target.files?.[0]); event.currentTarget.value = ""; }} />
      {value && <button type="button" onClick={() => { onChange(""); setFileName(""); setError(""); }} className="rounded-md p-2 text-muted hover:bg-white hover:text-ink" aria-label="移除图片"><X size={14} /></button>}
    </div>
    {error && <p role="alert" className="mt-1 text-[11px] text-error">{error}</p>}
  </div>;
}
