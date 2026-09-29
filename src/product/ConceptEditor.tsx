import { useState } from "react";
import type { Concept, Draft, Locale, MediaDraft, MediaDraftItem, Readiness } from "./model";
import { storedImages } from "./model";
import { words } from "./copy";
import taxonomy from "../../shared/taxonomy.json";
import TaxonomyPicker from "./TaxonomyPicker";
import Modal from "./Modal";

const inputClass = "mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm font-normal";
type SetField = <K extends keyof Draft>(key: K, value: Draft[K]) => void;

function TextItems({ label, value, onChange, locale }: { label: string; value: string[]; onChange: (value: string[]) => void; locale: Locale }) {
  return <fieldset className="space-y-2"><legend className="text-sm font-medium">{label}</legend>
    {value.map((item, index) => <div className="flex items-start gap-2" key={index}>
      <textarea aria-label={`${label} ${index + 1}`} value={item} rows={2} className={inputClass} onChange={(event) => onChange(value.map((previous, i) => i === index ? event.target.value : previous))} />
      <button type="button" aria-label={`${locale === "cn" ? "移除" : "Remove"} ${label} ${index + 1}`} onClick={() => onChange(value.filter((_, i) => i !== index))} className="mt-2 rounded-lg px-2 py-2 text-xs text-rose-800">{locale === "cn" ? "移除" : "Remove"}</button>
    </div>)}
    <button type="button" onClick={() => onChange([...value, ""])} className="rounded-lg border border-emerald-200 px-3 py-2 text-xs text-emerald-900">{locale === "cn" ? "添加" : "Add"} {label}</button>
  </fieldset>;
}

function LanguageForm({ language, draft, setField, media, existingImages, readiness, onChooseImages, onRemoveImage }: {
  language: Locale; draft: Draft; setField: SetField; media: MediaDraft; existingImages: string[]; readiness: Readiness | null;
  onChooseImages: (files?: FileList | File[]) => void; onRemoveImage: (index: number) => void;
}) {
  const cn = language === "cn";
  const copy = words[language];
  type TextSuffix = "Name" | "Aliases" | "Description" | "Article" | "Source" | "Tags" | "Wiki" | "Instruction";
  type ListSuffix = "Trigger" | "Questions" | "Avoid" | "Examples" | "Transform";
  const textField = (suffix: TextSuffix, label: string, rows = 1) => <label className="block text-xs font-medium text-slate-600">{label}{rows === 1 ?
    <input type={suffix === "Wiki" ? "url" : "text"} value={draft[`${language}${suffix}`]} onChange={(event) => setField(`${language}${suffix}`, event.target.value)} className={inputClass} /> :
    <textarea rows={rows} value={draft[`${language}${suffix}`]} onChange={(event) => setField(`${language}${suffix}`, event.target.value)} className={inputClass} />}</label>;
  const listField = (suffix: ListSuffix, label: string) => <TextItems locale={language} label={label} value={draft[`${language}${suffix}`]} onChange={(value) => setField(`${language}${suffix}`, value)} />;
  const images: MediaDraftItem[] = media ?? existingImages.map((hash) => ({ kind: "existing", hash }));
  return <section aria-label={cn ? "中文编辑" : "English editor"} className="space-y-5">
    {readiness && !readiness.browsable && <p className="rounded-lg bg-amber-50 p-3 text-xs text-amber-900">{copy.browseMissing}: {readiness.browse_missing.map((field) => ({ name: copy.name, description: copy.description, source_text: copy.sourceText }[field] ?? field)).join(" · ") || copy.none}</p>}
    {textField("Name", copy.name)}{textField("Description", cn ? "一句话解释（用于卡片与搜索）" : "Summary (card and search)", 3)}{textField("Aliases", copy.aliases)}
    <div><p className="mb-2 text-xs text-slate-500">{cn ? "文章正文使用 Markdown，可编辑标题、列表、链接和图片引用。下方结构化字段继续用于检索与推荐，请保持表述一致。" : "Article body uses Markdown for headings, lists, links, and image references. Keep the structured fields below consistent for search and recommendations."}</p>{textField("Article", cn ? "文章正文（Markdown）" : "Article body (Markdown)", 12)}</div>
    {textField("Source", copy.sourceText, 3)}{textField("Wiki", copy.wiki)}
    {listField("Trigger", cn ? "什么时候想到它" : "When to think of it")}
    {listField("Questions", cn ? "问自己" : "Questions to ask")}
    {listField("Avoid", cn ? "什么时候不适用" : "When not to use it")}
    {listField("Examples", cn ? "案例" : "Examples")}
    {textField("Tags", copy.tags)}
    <fieldset><legend className="text-sm font-medium">{copy.image}</legend>
      <div className="mt-2 flex flex-wrap gap-3">{images.map((image, index) => <div key={image.kind === "new" ? image.id : image.hash} className="rounded-lg border p-2">
        <img src={image.kind === "new" ? image.preview : `/api/assets/${image.hash}`} alt={`${language} ${index + 1}`} className="h-20 w-28 rounded object-cover" />
        <button type="button" onClick={() => onRemoveImage(index)} aria-label={`${copy.remove} ${copy.image} ${index + 1}`} className="mt-2 text-xs text-rose-800">{copy.remove}</button>
      </div>)}</div>
      {!images.length && <p className="my-2 text-xs text-slate-500">{copy.defaultImage}</p>}
      <input aria-label={cn ? "中文 WebP 图片" : "English WebP images"} type="file" accept="image/webp" multiple onChange={(event) => { onChooseImages(event.target.files ?? undefined); event.currentTarget.value = ""; }} className="mt-2 block w-full text-xs" />
    </fieldset>
    <details className="rounded-lg border border-slate-200 p-4"><summary className="cursor-pointer text-sm font-medium">{cn ? "高级：Agent 与推荐" : "Advanced: Agent and recommendations"}</summary>
      <div className="mt-4 space-y-4">{listField("Transform", cn ? "转化目标" : "Transform goals")}{textField("Instruction", copy.instruction, 3)}
        {readiness && <p className="text-xs text-slate-500">{copy.recommendMissing}: {readiness.recommend_missing.join(" · ") || copy.none}</p>}
      </div>
    </details>
  </section>;
}

export default function ConceptEditor({ editor, draft, locale, media, preview, busy, error, conflict, setField, onSave, onClose, onReload, onChooseImages, onRemoveImage }: {
  editor: Concept | "create"; draft: Draft; locale: Locale; media: Record<Locale, MediaDraft>; preview: Record<Locale, Readiness> | null;
  busy: boolean; error: string; conflict: boolean; setField: SetField; onSave: (event: React.FormEvent) => void; onClose: () => void; onReload: () => void;
  onChooseImages: (locale: Locale, files?: FileList | File[]) => void; onRemoveImage: (locale: Locale, index: number) => void;
}) {
  const [language, setLanguage] = useState<Locale>(locale);
  const t = words[locale];
  const picker = (kind: "domains" | "intents") => <TaxonomyPicker value={draft[kind]} options={taxonomy[kind]} locale={locale} label={kind === "domains" ? t.domain : t.intent} chooseLabel={kind === "domains" ? t.chooseDomains : t.chooseIntents} selectedLabel={kind === "domains" ? t.selectedDomains : t.selectedIntents} hint={kind === "domains" ? t.selectDomainHint : t.selectIntentHint} confirmLabel={t.confirm} cancelLabel={t.cancel} onChange={(values) => setField(kind, values)} />;
  return <Modal title={editor === "create" ? t.create : `${t.edit} · ${editor.locales[locale].name || editor.id}`} onClose={onClose} className="max-w-3xl">
    <form onSubmit={onSave} className="flex min-h-0 flex-col">
      <div className="space-y-5 overflow-y-auto p-5">
        <label className="block text-xs font-medium">{t.idLabel}<input value={draft.id} disabled={editor !== "create"} required onChange={(event) => setField("id", event.target.value)} className={inputClass} /></label>
        <div role="group" aria-label={locale === "cn" ? "编辑语言" : "Editing language"} className="flex gap-2">{(["cn", "en"] as const).map((lang) => <button key={lang} type="button" aria-pressed={language === lang} onClick={() => setLanguage(lang)} className={`rounded-lg px-4 py-2 text-sm ${language === lang ? "bg-emerald-900 text-white" : "bg-slate-100"}`}>{lang === "cn" ? "中文" : "English"}</button>)}</div>
        <LanguageForm key={language} language={language} draft={draft} setField={setField} media={media[language]} existingImages={editor === "create" ? [] : storedImages(editor.locales[language])} readiness={preview?.[language] ?? (editor === "create" ? null : editor.readiness[language])} onChooseImages={(files) => onChooseImages(language, files)} onRemoveImage={(index) => onRemoveImage(language, index)} />
        <section className="grid gap-4 border-t pt-5 sm:grid-cols-2">
          {picker("domains")}
          {([['interactionType', taxonomy.interaction_types, t.interactionType], ['epistemicType', taxonomy.epistemic_types, t.epistemicType]] as const).map(([field, options, label]) => <label key={field} className="text-xs font-medium">{label}<select value={draft[field]} onChange={(event) => setField(field, event.target.value)} className={inputClass}><option value="">{t.unspecified}</option>{options.map((option) => <option key={option.code} value={option.code}>{option[locale]}</option>)}</select></label>)}
          <details className="sm:col-span-2"><summary className="cursor-pointer text-sm">{locale === "cn" ? "高级：任务意图" : "Advanced: task intents"}</summary><div className="mt-3">{picker("intents")}</div></details>
        </section>
      </div>
      {(error || conflict) && <div role="alert" className="mx-5 mb-3 rounded-lg bg-rose-50 p-3 text-sm text-rose-800"><p>{conflict ? (locale === "cn" ? "此 Concept 已更新。重新载入前会保留你的草稿。" : "This Concept changed. Your draft is retained until you reload.") : error}</p>{conflict && <button type="button" onClick={onReload} className="mt-2 underline">{locale === "cn" ? "重新载入最新版本（放弃未保存修改）" : "Reload latest (discard unsaved edits)"}</button>}</div>}
      <footer className="flex justify-end gap-2 border-t bg-slate-50 px-5 py-4"><button type="button" disabled={busy} onClick={onClose} className="rounded-lg px-4 py-2 text-sm">{t.cancelLabel}</button><button type="submit" disabled={busy} className="rounded-lg bg-emerald-900 px-4 py-2 text-sm text-white disabled:opacity-50">{busy ? t.saving : t.save}</button></footer>
    </form>
  </Modal>;
}
