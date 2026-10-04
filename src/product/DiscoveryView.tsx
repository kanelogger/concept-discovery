import type { FormEvent } from "react";
import { ArrowUpRight, ChevronRight, Search, Sparkles } from "lucide-react";
import type { Concept, Locale, RelationView } from "./model";

export type DiscoveryResult = {
  locale: Locale;
  diagnosis: string[];
  recommendations: {
    id: string;
    concept_version: number;
    name: string;
    reason: string;
    confidence: number;
    card: { description: string; tags: string[]; cover_image: string; interaction_type: string | null; epistemic_type: string | null };
  }[];
};

type DiscoveryViewProps = {
  locale: Locale;
  query: string;
  searchInput: string;
  concepts: Concept[];
  count: number;
  page: number;
  pageCount: number;
  loading: boolean;
  error: string;
  discoveryResult: DiscoveryResult | null;
  discoveryConcepts: Record<string, Concept>;
  discoveryLoading: boolean;
  discoveryErrorCode: string;
  discoveryRequested: boolean;
  onSearchInput: (value: string) => void;
  onSubmitSearch: (event: FormEvent) => void;
  onRequestDiscovery: () => void;
  onRetryKeywords: () => void;
  onPageChange: (page: number) => void;
  onOpenConcept: (id: string) => void;
  onGoToLibrary: () => void;
  onGoToSettings: () => void;
};

const copy = {
  cn: {
    eyebrow: "CONCEPT DISCOVERY / FIELD NOTES",
    titleA: "给眼前的问题，",
    titleB: "找到已有的名字。",
    intro: "描述你遇到的情境。这里先呈现可查到的知识，再让你判断哪一种解释真正适用。",
    prompt: "你现在遇到了什么？",
    placeholder: "例如：大家都很忙，但交付越来越慢",
    submit: "寻找可能的概念",
    routeTitle: "从情境到判断",
    routeLabels: ["说清发生了什么", "比较不同解释", "核对边界与出处"],
    keyword: "关键词结果",
    ai: "AI 推荐",
    directRequest: "请求 AI 推荐",
    retry: "重试 AI 推荐",
    loading: "正在寻找相关概念…",
    empty: "没有找到匹配条目。你仍可请求 AI 查看是否有其他相关概念。",
    noKeyword: "没有关键词匹配；模型建议会在此处出现。",
    privacyNote: "关键词检索只读取本机 Registry；点击请求 AI 推荐后，情境会发送给当前选定的模型。",
    aiIdle: "请求 AI 提供另一种判断角度。返回线索后，仍需核对概念的边界与出处。",
    noModel: "当前没有已连接并选定的模型。关键词结果仍可使用。",
    failed: "AI 推荐暂时不可用。关键词结果仍可使用。",
    settings: "前往模型设置",
    noRecommendations: "没有找到明确适用的概念。你仍可查看关键词结果。",
    mergedRecommendations: "AI 建议已并入对应概念条目；每条概念只展示一次。",
    diagnosis: "情境线索",
    modelReason: "AI 推荐理由",
    reason: "关键词命中",
    matchName: "名称或别名命中",
    matchTrigger: "情境命中",
    matchQuestion: "问题或案例命中",
    matchDescription: "描述或标签命中",
    queryLabel: "提交情境",
    boundary: "适用边界",
    source: "出处",
    sourceMissing: "出处信息待补",
    detailUnavailable: "Registry 详情暂时不可读取。阅读该 Concept 时请再次核对边界与出处。",
    boundaryUnavailable: "请打开条目核对当前适用边界。",
    sourceUnavailable: "请打开条目核对出处。",
    read: "阅读详情",
    library: "打开知识库",
    available: "条可浏览 Concept",
    starts: "从库中条目开始探索",
    starterEmpty: "目前还没有可浏览的 Concept。你可以先到知识库整理条目，再回到这里探索。",
    starter: "输入情境以比较可能的概念",
    keywordLoading: "正在检索知识库…",
    registryError: "知识库暂时无法读取，请稍后重试。",
    retryRegistry: "重试搜索",
    resultCount: "个关键词结果",
    pageLabel: "页",
    previous: "上一页",
    next: "下一页",
    aiNotRun: "尚未请求模型",
    aiReady: "已提交模型请求",
    sampleDisclaimer: "知识条目与出处来自当前本地 Registry；推荐理由来自本次模型请求。",
  },
  en: {
    eyebrow: "CONCEPT DISCOVERY / FIELD NOTES",
    titleA: "Find a name",
    titleB: "for what you are seeing.",
    intro: "Describe the situation. Browse existing knowledge first, then decide which explanation applies.",
    prompt: "What is happening?",
    placeholder: "For example: Everyone is busy, but delivery keeps slowing down",
    submit: "Find possible Concepts",
    routeTitle: "From situation to judgment",
    routeLabels: ["Describe what is happening", "Compare explanations", "Check boundaries and sources"],
    keyword: "Keyword results",
    ai: "AI recommendations",
    directRequest: "Request AI recommendations",
    retry: "Retry AI recommendations",
    loading: "Finding related Concepts…",
    empty: "No keyword matches. You can still ask AI to look for related Concepts.",
    noKeyword: "No keyword matches. Model suggestions will appear here.",
    privacyNote: "Keyword search reads the local Registry. Your situation is sent to the selected model only after you request AI recommendations.",
    aiIdle: "Ask AI for another perspective, then check each Concept's boundaries and source before applying it.",
    noModel: "No model is connected and selected. Keyword results remain available.",
    failed: "AI recommendations are temporarily unavailable. Keyword results remain available.",
    settings: "Open model settings",
    noRecommendations: "No clear Concept fits this context. You can still browse keyword results.",
    mergedRecommendations: "AI suggestions have been added to matching Concepts; each Concept appears once.",
    diagnosis: "Situation cues",
    modelReason: "Why this Concept",
    reason: "Keyword match",
    matchName: "Name or alias match",
    matchTrigger: "Situation match",
    matchQuestion: "Question or example match",
    matchDescription: "Description or tag match",
    queryLabel: "Submitted situation",
    boundary: "When not to use it",
    source: "Source",
    sourceMissing: "Source information pending",
    detailUnavailable: "Registry details are temporarily unavailable. Recheck its boundaries and source before applying it.",
    boundaryUnavailable: "Open the Concept to check its current boundaries.",
    sourceUnavailable: "Open the Concept to check its source.",
    read: "Read Concept",
    library: "Open the library",
    available: "browsable Concepts",
    starts: "Start with a Concept in your registry",
    starterEmpty: "There are no browsable Concepts yet. Add an entry in the library, then return here to explore.",
    starter: "Describe a situation to compare possible Concepts",
    keywordLoading: "Searching the registry…",
    registryError: "The registry is temporarily unavailable. Please try again.",
    retryRegistry: "Retry search",
    resultCount: "keyword results",
    pageLabel: "page",
    previous: "Previous",
    next: "Next",
    aiNotRun: "Model not requested",
    aiReady: "Model request submitted",
    sampleDisclaimer: "Concept details and sources come from the local Registry; recommendation reasons come from the model request.",
  },
} satisfies Record<Locale, Record<string, string | string[]>>;

const relationLabels: Record<RelationView["relation_type"], Record<Locale, string>> = {
  related_to: { cn: "相关", en: "Related to" },
  often_used_with: { cn: "常配合", en: "Often used with" },
  contrasts_with: { cn: "对照", en: "Contrasts with" },
  extends: { cn: "扩展", en: "Extends" },
  part_of: { cn: "组成部分", en: "Part of" },
};

function sourceSummary(source: string) {
  return source.split(/\r?\n/).map((line) => line.trim()).find((line) => line && !/^https?:\/\//i.test(line)) ?? "";
}

function keywordMatch(concept: Concept, query: string, locale: Locale, words: Record<string, string | string[]>) {
  const local = concept.locales[locale];
  const needle = query.trim().toLocaleLowerCase();
  const groups: [string, string[]][] = [
    [words.matchName as string, [local.name, ...local.aliases]],
    [words.matchTrigger as string, local.trigger],
    [words.matchQuestion as string, [...local.questions, ...local.examples]],
    [words.matchDescription as string, [local.description, ...local.tags]],
  ];
  for (const [label, values] of groups) {
    const match = values.find((value) => value.toLocaleLowerCase().includes(needle));
    if (match) return { label, text: match };
  }
  return { label: words.reason as string, text: local.trigger[0] || local.description };
}

function Evidence({ concept, locale, reason, reasonLabel, aiReason, onOpen, onOpenRelated }: {
  concept: Concept;
  locale: Locale;
  reason: string;
  reasonLabel: string;
  aiReason?: string;
  onOpen: () => void;
  onOpenRelated: (id: string) => void;
}) {
  const words = copy[locale];
  const local = concept.locales[locale];
  const source = sourceSummary(local.source_text);
  return <article className="group rounded-xl border border-slate-200 bg-white p-5 shadow-panel transition hover:border-slate-300 hover:shadow-panel-hover sm:p-7">
    <div className="flex flex-wrap items-center gap-2 text-[11px] font-semibold uppercase tracking-[.14em] text-brand-800">
      <span>{reasonLabel}</span><span aria-hidden="true" className="text-slate-400">/</span><span>{concept.id}</span>
    </div>
    <h3 className="mt-3 font-display text-2xl font-semibold leading-tight text-ink sm:text-3xl">{local.name || concept.id}</h3>
    <p className="mt-3 text-base leading-8 text-muted">{local.description}</p>
    <dl className="mt-6 grid gap-4 border-t border-slate-200 pt-5">
      <div className="grid gap-1 sm:grid-cols-[8rem_1fr] sm:gap-4">
        <dt className="text-sm font-semibold text-slate-600">{reasonLabel === words.modelReason ? words.modelReason : words.reason}</dt>
        <dd className="m-0 text-sm leading-7 text-ink">{reason}</dd>
      </div>
      {aiReason && <div className="grid gap-1 sm:grid-cols-[8rem_1fr] sm:gap-4"><dt className="text-sm font-semibold text-brand-800">{words.modelReason}</dt><dd className="m-0 text-sm leading-7 text-ink">{aiReason}</dd></div>}
      {local.avoid_when.length > 0 && <div className="grid gap-1 sm:grid-cols-[8rem_1fr] sm:gap-4">
        <dt className="text-sm font-semibold text-slate-600">{words.boundary}</dt>
        <dd className="m-0 text-sm leading-7 text-ink">{local.avoid_when[0]}</dd>
      </div>}
      <div className="grid gap-1 sm:grid-cols-[8rem_1fr] sm:gap-4">
        <dt className="text-sm font-semibold text-slate-600">{words.source}</dt>
        <dd className="m-0 text-sm leading-7 text-ink">{source || words.sourceMissing}</dd>
      </div>
    </dl>
    {!!concept.relation_preview?.length && <div className="mt-5 flex flex-wrap gap-2 border-t border-slate-200 pt-4">
      {concept.relation_preview.map((relation) => <button key={relation.id} type="button" onClick={() => onOpenRelated(relation.other.id)} className="inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-brand-200 bg-brand-50 px-3 text-sm font-medium text-brand-800 hover:bg-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-700">
        {relationLabels[relation.relation_type][locale]} · {relation.other.name || relation.other.id}<ChevronRight size={15} />
      </button>)}
    </div>}
    <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 pt-4">
      <div className="flex flex-wrap gap-2">{local.tags.slice(0, 3).map((tag) => <span key={tag} className="rounded-full bg-surface-alt px-2.5 py-1 text-xs font-medium text-slate-700">{tag}</span>)}</div>
      <button type="button" onClick={onOpen} className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-brand-900 px-4 text-sm font-semibold text-white transition hover:bg-brand-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-700">
        {words.read}<ArrowUpRight size={16} />
      </button>
    </div>
  </article>;
}

export default function DiscoveryView({
  locale, query, searchInput, concepts, count, page, pageCount, loading, error, discoveryResult, discoveryConcepts,
  discoveryLoading, discoveryErrorCode, discoveryRequested, onSearchInput, onSubmitSearch,
  onRequestDiscovery, onRetryKeywords, onPageChange, onOpenConcept, onGoToLibrary, onGoToSettings,
}: DiscoveryViewProps) {
  const words = copy[locale];
  const cn = locale === "cn";
  const aiItems = discoveryResult?.recommendations ?? [];
  const hasAiResult = discoveryResult !== null;

  return <div className="discovery-page mx-auto max-w-[1440px] px-5 pb-20 md:px-10">
    <section className="grid items-center gap-9 pb-11 pt-12 lg:grid-cols-[minmax(0,7fr)_minmax(280px,5fr)] lg:gap-16 lg:pb-14 lg:pt-16" aria-labelledby="discovery-title">
      <div>
        <p className="flex items-center gap-3 font-mono text-[11px] font-semibold uppercase tracking-[.18em] text-signal-800"><span className="h-px w-7 bg-signal-800" />{words.eyebrow}</p>
        <h1 id="discovery-title" aria-label={cn ? "给眼前的问题，找到已有的名字。" : "Find a name for what you are seeing."} className="mt-6 max-w-4xl font-display text-[clamp(2.5rem,5.2vw,4.6rem)] font-semibold leading-[1.2] tracking-tight text-ink">
          {words.titleA}<br /><span className="text-brand-800">{words.titleB}</span>
        </h1>
        <p className="mt-6 max-w-2xl text-base leading-8 text-muted sm:text-lg">{words.intro}</p>
        <div className="mt-7 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-slate-600"><span className="font-semibold text-ink">{count}</span><span>{words.available}</span><button type="button" onClick={onGoToLibrary} className="ml-1 inline-flex min-h-10 items-center gap-1 font-semibold text-brand-800 underline decoration-brand-200 underline-offset-4 hover:text-brand-700">{words.library}<ArrowUpRight size={14} /></button></div>
      </div>
      <aside className="hidden rounded-2xl border border-slate-200 bg-white p-7 shadow-panel lg:block" aria-label={words.routeTitle}>
        <div className="flex items-center justify-between font-mono text-[11px] font-semibold tracking-[.12em] text-slate-600"><span>FIELD MAP</span><span>01 — 03</span></div>
        <ol className="relative mt-8 space-y-5 before:absolute before:bottom-5 before:left-[17px] before:top-5 before:border-l before:border-dashed before:border-slate-300">
          {(words.routeLabels as string[]).map((label, index) => <li key={label} className="relative flex items-center gap-4">
            <span className={`grid size-9 shrink-0 place-items-center rounded-full border text-xs font-semibold ${index === 1 ? "border-brand-800 bg-brand-800 text-white" : "border-slate-300 bg-white text-slate-700"}`}>0{index + 1}</span>
            <span className="text-sm font-medium text-ink">{label}</span>
          </li>)}
        </ol>
        <p className="mt-7 border-t border-slate-200 pt-4 font-mono text-[10px] tracking-[.08em] text-slate-600">KNOWLEDGE IS A STARTING POINT, NOT A VERDICT.</p>
      </aside>
    </section>

    <form onSubmit={onSubmitSearch} role="search" className="rounded-2xl border border-slate-200 bg-white p-4 shadow-panel sm:p-6">
      <label htmlFor="discovery-query" className="block text-sm font-semibold text-ink">{words.prompt}</label>
      <div className="mt-3 flex flex-col gap-3 sm:flex-row">
        <div className="relative min-w-0 flex-1">
          <Search size={18} aria-hidden="true" className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-slate-600" />
          <input id="discovery-query" aria-label={cn ? "描述当前情境" : "Describe the situation"} value={searchInput} onChange={(event) => onSearchInput(event.target.value)} placeholder={words.placeholder} className="min-h-14 w-full rounded-lg border border-slate-300 bg-white py-3 pl-11 pr-4 text-base text-ink placeholder:text-slate-500 hover:border-slate-500 focus:border-brand-700 focus:outline-none focus:ring-2 focus:ring-brand-200" />
        </div>
        <button type="submit" disabled={!searchInput.trim()} className="inline-flex min-h-14 shrink-0 items-center justify-center gap-2 rounded-lg bg-brand-900 px-6 text-sm font-semibold text-white transition hover:bg-brand-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-700 disabled:cursor-not-allowed disabled:opacity-50">
          {words.submit}<ArrowUpRight size={17} />
        </button>
      </div>
      <p className="mt-3 text-xs leading-6 text-slate-600">{words.privacyNote}</p>
    </form>

    {query ? <section id="discovery-results" className="scroll-mt-24 pt-12" aria-labelledby="results-title">
      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-slate-300 pb-5">
        <div><p className="font-mono text-[11px] font-semibold uppercase tracking-[.15em] text-signal-800">02 / POSSIBLE LENSES</p><h2 id="results-title" className="mt-2 font-display text-3xl font-semibold leading-tight text-ink sm:text-4xl">{cn ? "同一情境，不同解释角度" : "Different lenses on one situation"}</h2><p className="mt-2 max-w-3xl break-words text-sm leading-6 text-slate-600"><span className="font-semibold text-slate-700">{words.queryLabel}: </span>{query}</p></div>
        <p className="text-sm text-slate-600">{count} {words.resultCount}</p>
      </div>
      <div className="my-5 flex flex-wrap gap-2">
        <span className="inline-flex min-h-8 items-center gap-2 rounded-full border border-slate-300 bg-white px-3 text-xs text-slate-700"><span className="size-2 rounded-full bg-success-700" />{words.keyword}</span>
        <span className="inline-flex min-h-8 items-center gap-2 rounded-full border border-slate-300 bg-white px-3 text-xs text-slate-700"><Sparkles size={13} className="text-signal-800" />{words.ai}{discoveryRequested ? ` · ${words.aiReady}` : ` · ${words.aiNotRun}`}</span>
      </div>
      {error && <div className="mb-5 rounded-lg border border-rose-200 bg-rose-50 p-4"><p role="alert" className="text-sm text-rose-800">{words.registryError}</p><button type="button" onClick={onRetryKeywords} className="mt-2 min-h-10 text-sm font-semibold text-brand-800 underline">{words.retryRegistry}</button></div>}
      {loading && <p role="status" className="rounded-xl border border-slate-200 bg-white p-6 text-sm text-slate-700">{words.keywordLoading}</p>}
      {!loading && !error && concepts.length === 0 && <p className="mb-5 rounded-xl border border-dashed border-slate-300 bg-white p-6 text-sm text-slate-700">{words.noKeyword}</p>}
      <div className="grid items-start gap-8 xl:grid-cols-[minmax(0,8fr)_minmax(250px,4fr)]">
        <div className="space-y-4">
          {!loading && concepts.map((concept) => {
            const match = keywordMatch(concept, query, locale, words);
            const aiMatch = aiItems.find((item) => item.id === concept.id);
            return <Evidence key={concept.id} concept={concept} locale={locale} reason={match.text} reasonLabel={match.label} aiReason={aiMatch?.reason} onOpen={() => onOpenConcept(concept.id)} onOpenRelated={onOpenConcept} />;
          })}
          {!loading && !error && concepts.length === 0 && <button type="button" onClick={onGoToLibrary} className="inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-brand-800 underline underline-offset-4">{words.library}<ArrowUpRight size={15} /></button>}
          {!loading && pageCount > 1 && <nav aria-label={cn ? "关键词结果分页" : "Keyword result pages"} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3"><span className="text-xs text-slate-700">{page} / {pageCount} {words.pageLabel}</span><div className="flex gap-2"><button type="button" onClick={() => onPageChange(Math.max(1, page - 1))} disabled={page <= 1} className="min-h-11 rounded-lg border border-slate-300 px-3 text-sm font-semibold text-slate-800 disabled:opacity-50">{words.previous}</button><button type="button" onClick={() => onPageChange(Math.min(pageCount, page + 1))} disabled={page >= pageCount} className="min-h-11 rounded-lg border border-slate-300 px-3 text-sm font-semibold text-slate-800 disabled:opacity-50">{words.next}</button></div></nav>}
        </div>
        <aside className="rounded-2xl border border-slate-200 bg-surface-alt p-5 sm:p-6" aria-labelledby="ai-heading">
          <p className="font-mono text-[11px] font-semibold uppercase tracking-[.14em] text-signal-800">03 / FOLLOW THE THREAD</p>
          <h3 id="ai-heading" className="mt-2 font-display text-2xl font-semibold text-ink">{words.ai}</h3>
          {discoveryResult?.diagnosis.length ? <div className="mt-4 space-y-2 text-sm leading-7 text-ink">{discoveryResult.diagnosis.map((line, index) => <p key={`${line}-${index}`}>{line}</p>)}</div> : <p className="mt-3 text-sm leading-7 text-muted">{words.aiIdle}</p>}
          {!discoveryRequested && <button type="button" onClick={onRequestDiscovery} className="mt-5 inline-flex min-h-11 items-center gap-2 rounded-lg border border-brand-800 bg-white px-4 text-sm font-semibold text-brand-800 hover:bg-brand-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-700">{words.directRequest}<ArrowUpRight size={15} /></button>}
          {discoveryLoading && <p role="status" className="mt-5 rounded-lg bg-white p-4 text-sm text-slate-700">{words.loading}</p>}
          {discoveryErrorCode && <div className="mt-5 rounded-lg border border-rose-200 bg-white p-4">
            <p role="alert" className="text-sm leading-6 text-rose-800">{discoveryErrorCode === "model_unavailable" ? words.noModel : words.failed}</p>
            {discoveryErrorCode === "model_unavailable" ? <button type="button" onClick={onGoToSettings} className="mt-3 inline-flex min-h-10 items-center text-sm font-semibold text-brand-800 underline underline-offset-4">{words.settings}<ArrowUpRight size={14} className="ml-1" /></button> : <button type="button" onClick={onRequestDiscovery} className="mt-3 inline-flex min-h-10 items-center rounded-md bg-brand-900 px-3 text-sm font-semibold text-white hover:bg-brand-700">{words.retry}</button>}
          </div>}
          {discoveryRequested && !discoveryLoading && !discoveryErrorCode && hasAiResult && aiItems.length === 0 && <p role="status" className="mt-5 rounded-lg bg-white p-4 text-sm leading-6 text-slate-700">{words.noRecommendations}</p>}
          {aiItems.length > 0 && aiItems.every((item) => concepts.some((concept) => concept.id === item.id)) && <p role="status" className="mt-5 rounded-lg bg-white p-4 text-sm leading-6 text-slate-700">{words.mergedRecommendations}</p>}
          {aiItems.some((item) => !concepts.some((concept) => concept.id === item.id)) && <div className="mt-5 space-y-4">{aiItems.filter((item) => !concepts.some((concept) => concept.id === item.id)).map((item) => {
            const concept = discoveryConcepts[item.id];
            if (!concept) return <article key={item.id} className="rounded-xl border border-amber-200 bg-white p-4">
              <p className="text-sm font-semibold text-ink">{item.name}</p><p className="mt-2 text-sm leading-6 text-muted">{item.card.description}</p><p className="mt-3 border-t border-slate-200 pt-3 text-sm leading-6 text-ink"><span className="font-semibold">{words.modelReason}: </span>{item.reason}</p><dl className="mt-3 space-y-2 text-sm"><div><dt className="font-semibold text-slate-700">{words.boundary}</dt><dd className="m-0 mt-1 text-slate-700">{words.boundaryUnavailable}</dd></div><div><dt className="font-semibold text-slate-700">{words.source}</dt><dd className="m-0 mt-1 text-slate-700">{words.sourceUnavailable}</dd></div></dl><p role="status" className="mt-3 border-t border-slate-200 pt-3 text-xs leading-5 text-amber-900">{words.detailUnavailable}</p><button type="button" onClick={() => onOpenConcept(item.id)} className="mt-3 inline-flex min-h-10 items-center text-sm font-semibold text-brand-800 underline">{words.read}<ArrowUpRight size={14} className="ml-1" /></button>
            </article>;
            return <Evidence key={item.id} concept={concept} locale={locale} reason={item.reason} reasonLabel={words.modelReason} onOpen={() => onOpenConcept(item.id)} onOpenRelated={onOpenConcept} />;
          })}</div>}
          {hasAiResult && <p className="mt-4 text-xs leading-5 text-slate-600">{words.sampleDisclaimer}</p>}
        </aside>
      </div>
    </section> : <section className="pt-12" aria-labelledby="starter-heading">
      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-slate-300 pb-5"><div><p className="font-mono text-[11px] font-semibold uppercase tracking-[.15em] text-signal-800">01 / START WITH A CUE</p><h2 id="starter-heading" className="mt-2 font-display text-3xl font-semibold text-ink">{words.starts}</h2></div><p className="text-sm text-slate-600">{concepts.length} {words.available}</p></div>
      {loading ? <p role="status" className="mt-5 text-sm text-slate-700">{words.keywordLoading}</p> : error ? <div className="mt-5 rounded-xl border border-rose-200 bg-rose-50 p-5"><p role="alert" className="text-sm text-rose-800">{words.registryError}</p><button type="button" onClick={onRetryKeywords} className="mt-2 min-h-10 text-sm font-semibold text-brand-800 underline">{words.retryRegistry}</button></div> : concepts.length === 0 ? <div className="mt-5 rounded-xl border border-dashed border-slate-300 bg-white p-6"><p className="text-sm leading-7 text-slate-700">{words.starterEmpty}</p><button type="button" onClick={onGoToLibrary} className="mt-3 inline-flex min-h-11 items-center gap-2 font-semibold text-brand-800 underline underline-offset-4">{words.library}<ArrowUpRight size={14} /></button></div> : <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-3">{concepts.slice(0, 3).map((concept) => {
        const local = concept.locales[locale];
        return <article key={concept.id} className="rounded-xl border border-slate-200 bg-white p-5 shadow-panel">
          <p className="font-mono text-[10px] font-semibold uppercase tracking-[.12em] text-signal-800">{concept.id}</p><h3 className="mt-2 font-display text-xl font-semibold text-ink">{local.name || concept.id}</h3><p className="mt-2 line-clamp-2 text-sm leading-6 text-muted">{local.description}</p>
          {local.trigger[0] && <button type="button" onClick={() => onSearchInput(local.trigger[0])} className="mt-4 block w-full rounded-lg bg-surface-alt p-3 text-left text-sm leading-6 text-ink hover:bg-brand-50"><span className="mb-1 block text-xs font-semibold text-slate-700">{words.starter}</span>{local.trigger[0]}</button>}
          <button type="button" onClick={() => onOpenConcept(concept.id)} className="mt-4 inline-flex min-h-10 items-center gap-1 text-sm font-semibold text-brand-800 underline underline-offset-4">{words.read}<ArrowUpRight size={14} /></button>
        </article>;
      })}</div>}
    </section>}
  </div>;
}
