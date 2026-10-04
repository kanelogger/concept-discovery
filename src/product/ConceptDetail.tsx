import { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Concept, Locale } from "./model";
import { storedImages } from "./model";
import { labelsFor } from "./copy";
import RelationPanel from "./RelationPanel";
import Modal from "./Modal";

function KnowledgeList({ title, items }: { title: string; items: string[] }) {
  return items.length ? <section className="mt-7"><h3 className="font-display text-lg font-semibold text-ink">{title}</h3><ul className="mt-3 list-disc space-y-2 pl-5 text-base leading-8 text-slate-700">{items.map((item, index) => <li key={index} className="whitespace-pre-wrap break-words">{item}</li>)}</ul></section> : null;
}

const sourceSummary = (source: string) => source.split(/\r?\n/).map((line) => line.trim()).find((line) => line && !/^https?:\/\//i.test(line)) ?? "";

function ImageGallery({ concept, locale }: { concept: Concept; locale: Locale }) {
  const [index, setIndex] = useState<number | null>(null);
  const images = storedImages(concept.locales[locale]);
  return <>{images.length > 0 && <div className="mt-4 flex flex-wrap gap-3">{images.map((hash, i) => <button type="button" key={hash} onClick={() => setIndex(i)} aria-label={`${locale === "cn" ? "查看图片" : "View image"} ${i + 1}`}><img src={`/api/assets/${hash}`} alt="" className="h-24 w-36 rounded-xl border object-cover" /></button>)}</div>}
    {index !== null && <Modal title={`${locale === "cn" ? "图片" : "Image"} ${index + 1} / ${images.length}`} onClose={() => setIndex(null)}>
      <div className="overflow-auto p-4"><img src={`/api/assets/${images[index]}`} alt={concept.locales[locale].name} className="mx-auto max-h-[70dvh] max-w-full object-contain" /></div>
      {images.length > 1 && <div className="flex justify-between p-4"><button type="button" onClick={() => setIndex((index + images.length - 1) % images.length)}>{locale === "cn" ? "上一张" : "Previous image"}</button><button type="button" onClick={() => setIndex((index + 1) % images.length)}>{locale === "cn" ? "下一张" : "Next image"}</button></div>}
    </Modal>}
  </>;
}

export default function ConceptDetail({ concept, locale, manage, refreshKey, onClose, onRefresh, onEdit, onArchive, onRestore, onDelete, onOpenRelatedConcept, onLocale, error }: {
  concept: Concept; locale: Locale; manage: boolean; refreshKey: number; onLocale: (locale: Locale) => void; error: string;
  onClose: () => void; onRefresh: () => void; onEdit: () => void; onArchive: () => void; onRestore: () => void; onDelete: () => void; onOpenRelatedConcept: (id: string) => void;
}) {
  const cn = locale === "cn";
  const local = concept.locales[locale];
  const otherLocale = cn ? "en" : "cn";
  const otherArticleAvailable = Boolean(concept.locales[otherLocale].article_body?.trim());
  const ready = concept.readiness[locale];
  const missing = ([["trigger", cn ? "触发场景" : "Triggers"], ["questions", cn ? "问题" : "Questions"], ["avoid_when", cn ? "边界" : "Boundaries"], ["examples", cn ? "案例" : "Examples"]] as const).filter(([field]) => !local[field].length).map(([, label]) => label);
  const articleBody = (local.article_body ?? "").trim();
  return <article className="mx-auto max-w-3xl pb-16">
    <div className="flex flex-wrap items-center justify-between gap-4 py-7"><button type="button" onClick={onClose} className="min-h-11 text-sm font-semibold text-brand-800 hover:underline">← {manage ? (cn ? "返回知识库" : "Back to library") : (cn ? "返回发现" : "Back to discovery")}</button><div role="group" aria-label={cn ? "阅读语言" : "Reading language"} className="flex gap-2">{(["cn", "en"] as const).map((language) => <button key={language} type="button" aria-pressed={locale === language} onClick={() => onLocale(language)} className={`min-h-11 rounded-lg px-4 text-sm font-semibold ${locale === language ? "bg-brand-900 text-white" : "border border-slate-300 bg-white text-slate-700 hover:bg-brand-50"}`}>{language === "cn" ? "中文" : "English"}</button>)}</div></div>
    <div className="detail-sheet rounded-xl border border-slate-200 bg-white px-5 py-7 shadow-panel sm:px-10 sm:py-10">
      <header><p className="font-mono text-[11px] font-semibold uppercase tracking-[.12em] text-signal-800">CONCEPT / {concept.id}</p><h1 className="mt-4 break-words font-display text-4xl font-semibold leading-tight tracking-tight text-ink sm:text-5xl">{local.name || concept.id}</h1><div className="mt-4 flex flex-wrap items-center gap-3 text-sm text-slate-600"><span>{local.tags.join(" · ")}</span>{!ready.browsable && <span className="rounded bg-warning-soft px-3 py-2 text-amber-900">{concept.lifecycle_status === "archived" ? (cn ? "已归档" : "Archived") : `${cn ? "当前语言待补" : "This language needs"}: ${ready.browse_missing.join(" · ")}`}</span>}</div></header>
      {manage && !articleBody && missing.length > 0 && <p className="mt-3 text-xs text-slate-500">{cn ? "知识内容待补（可继续浏览）" : "Knowledge content to add (browsing remains available)"}: {missing.join(" · ")}</p>}
      {error && <p role="alert" className="mt-3 rounded-lg bg-rose-50 p-3 text-sm text-rose-800">{error}</p>}
      <ImageGallery key={`${concept.id}/${locale}/${local.cover_images.join()}`} concept={concept} locale={locale} />
      {articleBody && local.description && <section className="mt-7 rounded-lg border-l-2 border-signal-700 bg-surface-alt p-4 sm:p-5"><h2 className="text-xs font-semibold uppercase tracking-[.1em] text-slate-700">{cn ? "一句话解释" : "In brief"}</h2><p className="mt-2 text-base leading-8 text-ink">{local.description}</p></section>}
      {local.source_text && <section className="mt-6 rounded-lg border border-slate-200 bg-white p-4 sm:p-5"><h2 className="text-xs font-semibold uppercase tracking-[.1em] text-slate-700">{cn ? "出处" : "Source"}</h2><p className="mt-2 break-words text-sm leading-6 text-ink">{sourceSummary(local.source_text) || (cn ? "出处信息待补" : "Source information pending")}</p><details className="mt-2"><summary className="min-h-10 w-fit cursor-pointer py-2 text-sm font-semibold text-brand-800 hover:underline">{cn ? "查看完整出处记录" : "View full source record"}</summary><p className="mt-2 whitespace-pre-wrap break-words text-sm leading-7 text-slate-700">{local.source_text}</p></details></section>}
      {articleBody ? <div className="mt-9 break-words text-[17px] leading-8 text-ink"><ReactMarkdown remarkPlugins={[remarkGfm]} components={{
        h1: ({ children }) => <h2 className="mb-4 mt-10 font-display text-3xl font-semibold leading-tight text-ink">{children}</h2>,
        h2: ({ children }) => <h2 className="mb-4 mt-10 font-display text-2xl font-semibold leading-tight text-ink">{children}</h2>,
        h3: ({ children }) => <h3 className="mb-3 mt-8 font-display text-xl font-semibold text-ink">{children}</h3>,
        p: ({ children }) => <p className="my-5 leading-8">{children}</p>,
        ul: ({ children }) => <ul className="my-5 list-disc space-y-2 pl-6">{children}</ul>,
        ol: ({ children }) => <ol className="my-5 list-decimal space-y-2 pl-6">{children}</ol>,
        a: ({ href, children }) => <a href={href} target="_blank" rel="noreferrer" className="text-brand-800 underline">{children}</a>,
        img: ({ src, alt }) => src && /^\/api\/assets\/[a-f0-9]{64}$/.test(src) ? <img src={src} alt={alt ?? ""} className="my-7 h-auto max-w-full rounded-lg" /> : <span className="text-sm text-amber-800">{cn ? "图片暂不可用" : "Image unavailable"}</span>,
        table: ({ children }) => <div className="my-6 overflow-x-auto"><table className="w-full border-collapse text-sm">{children}</table></div>,
        th: ({ children }) => <th className="border bg-slate-50 px-3 py-2 text-left font-semibold">{children}</th>,
        td: ({ children }) => <td className="border px-3 py-2 align-top">{children}</td>,
      }}>{articleBody}</ReactMarkdown></div> : <div className="mt-9"><div className="rounded-lg bg-amber-50 p-4 text-sm text-amber-900"><p>{cn ? "文章正文待补，以下为已有知识字段。" : "Article body pending. Existing knowledge fields are shown below."}</p>{otherArticleAvailable && <button type="button" onClick={() => onLocale(otherLocale)} className="mt-2 font-semibold text-brand-900 underline">{cn ? "阅读英文原文 →" : "Read Chinese article →"}</button>}</div>{local.description && <section className="mt-6"><h2 className="text-sm font-semibold text-brand-950">{cn ? "是什么" : "What it is"}</h2><p className="mt-2 whitespace-pre-wrap break-words text-base leading-8">{local.description}</p></section>}<KnowledgeList title={cn ? "什么时候想到它" : "When to think of it"} items={local.trigger} /><KnowledgeList title={cn ? "问自己" : "Questions to ask"} items={local.questions} /><KnowledgeList title={cn ? "什么时候不适用" : "When not to use it"} items={local.avoid_when} /><KnowledgeList title={cn ? "案例" : "Examples"} items={local.examples} /></div>}
      <RelationPanel conceptId={concept.id} lifecycleStatus={concept.lifecycle_status} locale={locale} manage={manage} refreshKey={refreshKey} onOpenConcept={onOpenRelatedConcept} onChanged={onRefresh} />
      {local.wiki_url && <a href={local.wiki_url} target="_blank" rel="noreferrer" className="mt-3 inline-block text-sm text-brand-800 underline">{cn ? "延伸阅读" : "Further reading"}</a>}
      <details className="mt-6 rounded-xl border p-4"><summary className="cursor-pointer text-sm font-medium">{cn ? "管理信息与 Agent 字段" : "Management and Agent fields"}</summary><div className="mt-3 space-y-2 break-words text-xs leading-6 text-slate-500"><p>{concept.id} · v{concept.version} · {concept.lifecycle_status}</p><p>{labelsFor(concept, locale).join(" · ")}</p><p>{cn ? "别名" : "Aliases"}: {local.aliases.join(" · ")}</p><p>{cn ? "领域 / 意图" : "Domains / Intents"}: {[...concept.domains, ...concept.intents].join(" · ")}</p><p>{concept.created_at} → {concept.updated_at}</p><p>{cn ? "推荐条件待补" : "Recommendation missing"}: {ready.recommend_missing.join(" · ") || "—"}</p><p className="whitespace-pre-wrap">{local.agent_instruction}</p><KnowledgeList title={cn ? "转化目标" : "Transform goals"} items={local.transform} /></div></details>
      {manage && <footer className="mt-8 flex flex-wrap gap-3 border-t pt-5 text-sm"><button onClick={onEdit} className="rounded-lg bg-brand-900 px-4 py-2 text-white">{cn ? "编辑" : "Edit"}</button><button onClick={onRefresh} className="rounded-lg border px-4 py-2">{cn ? "刷新" : "Reload"}</button>{concept.lifecycle_status === "active" ? <button onClick={onArchive} className="px-3 py-2 text-rose-800">{cn ? "删除" : "Delete"}</button> : <><button onClick={onRestore} className="px-3 py-2 text-brand-900">{cn ? "恢复" : "Restore"}</button><button onClick={onDelete} className="px-3 py-2 text-rose-800">{cn ? "永久删除" : "Permanently delete"}</button></>}</footer>}
    </div>
  </article>;
}
