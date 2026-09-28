import * as Dialog from "@radix-ui/react-dialog";
import { BookOpen, X } from "lucide-react";
import type { Locale } from "./model";

export type DiscoveryResult = {
  locale: Locale;
  diagnosis: string[];
  recommendations: {
    id: string; name: string; reason: string; confidence: number;
    card: { description: string; tags: string[]; cover_image: string; interaction_type: string | null; epistemic_type: string | null };
  }[];
};

export default function RecommendationDrawer({ locale, query, result, loading, error, onClose, onOpenConcept }: {
  locale: Locale; query: string; result: DiscoveryResult | null; loading: boolean; error: string;
  onClose: () => void; onOpenConcept: (id: string) => void;
}) {
  const cn = locale === "cn";
  return <Dialog.Root open onOpenChange={(open) => { if (!open) onClose(); }}>
    <Dialog.Portal>
      <Dialog.Overlay className="fixed inset-0 z-50 bg-slate-950/40" />
      <Dialog.Content className="fixed inset-y-0 right-0 z-50 flex h-dvh w-full max-w-lg flex-col bg-white shadow-2xl outline-none">
        <header className="flex shrink-0 items-start justify-between gap-4 border-b border-slate-200 p-5">
          <div className="min-w-0"><Dialog.Title className="text-xl font-semibold">{cn ? "相关 Concept 推荐" : "Related Concepts"}</Dialog.Title><Dialog.Description className="mt-1 break-words text-sm text-slate-500">{cn ? "搜索情境：" : "Search context: "}{query}</Dialog.Description></div>
          <button type="button" onClick={onClose} aria-label={cn ? "关闭推荐" : "Close recommendations"} className="shrink-0 rounded-lg p-2 hover:bg-slate-100"><X size={18} /></button>
        </header>
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto bg-slate-50 p-4 sm:p-5">
          {loading && <p role="status" className="rounded-xl bg-white p-5 text-sm text-slate-600">{cn ? "正在寻找相关概念…" : "Finding related Concepts…"}</p>}
          {!loading && error && <p role="alert" className="rounded-xl border border-rose-200 bg-white p-5 text-sm text-rose-800">{error}</p>}
          {!loading && !error && result?.diagnosis.length ? <div className="rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-700">{result.diagnosis.map((line, index) => <p key={index}>{line}</p>)}</div> : null}
          {!loading && !error && result?.recommendations.length === 0 && <p role="status" className="rounded-xl bg-white p-5 text-sm text-slate-600">{cn ? "当前知识库没有明确适合这段情境的概念。你仍可查看左侧关键词结果。" : "No clear Concept fits this context. You can still browse the keyword results."}</p>}
          {!loading && !error && result?.recommendations.map((item) => <article key={item.id} className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            <button type="button" className="block w-full text-left hover:bg-slate-50" onClick={() => onOpenConcept(item.id)}>
              <div className="flex h-32 items-center justify-center bg-gradient-to-br from-emerald-50 to-slate-100 text-emerald-700">{item.card.cover_image ? <img src={`/api/assets/${item.card.cover_image}`} alt="" className="h-full w-full object-cover" /> : <BookOpen size={28} />}</div>
              <div className="p-5"><h3 className="text-lg font-semibold text-slate-900">{item.name}</h3><p className="mt-1 text-sm text-slate-600">{item.card.description}</p>{item.card.tags.length > 0 && <p className="mt-3 text-xs text-emerald-800">{item.card.tags.join(" · ")}</p>}</div>
            </button>
            <div className="border-t border-slate-100 bg-emerald-50 px-5 py-4"><p className="text-xs font-semibold text-emerald-900">{cn ? "推荐理由" : "Why this Concept"}</p><p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-emerald-950">{item.reason}</p></div>
          </article>)}
        </div>
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>;
}
