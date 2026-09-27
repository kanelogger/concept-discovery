import { BookOpen } from "lucide-react";
import type { Concept, Locale } from "./model";
import { labelsFor } from "./copy";
export default function ConceptCard({ concept, locale, manage, selected, onSelect, onArchive, onRestore, onDelete }: { concept: Concept; locale: Locale; manage: boolean; selected: boolean; onSelect: () => void; onArchive: () => void; onRestore: () => void; onDelete: () => void }) {
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

