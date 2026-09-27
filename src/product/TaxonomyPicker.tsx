import { useState } from "react";
import Modal from "./Modal";
import type { Locale } from "./model";
export default function TaxonomyPicker({ value, options, locale, label, chooseLabel, selectedLabel, hint, confirmLabel, cancelLabel, onChange }: {
  value: string[]; options: readonly { code: string; cn: string; en: string }[]; locale: Locale; label?: string; chooseLabel: string; selectedLabel: string; hint: string;
  confirmLabel: string; cancelLabel: string; onChange: (codes: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState<string[]>(value);
  const names = value.map((code) => options.find((item) => item.code === code)?.[locale] ?? code);
  const toggle = (code: string) => setPending((current) => current.includes(code) ? current.filter((item) => item !== code) : [...current, code]);
  return <div className="text-xs font-medium text-slate-600">
    {label && <span>{label}</span>}
    <button type="button" aria-haspopup="dialog" aria-expanded={open} onClick={() => { setPending(value); setOpen(true); }} className={`${label ? "mt-1.5 " : ""}flex min-h-10 w-full items-center justify-between gap-3 rounded-lg border border-slate-300 bg-white px-3 py-2 text-left text-sm font-normal text-slate-700 hover:border-emerald-700`}>
      <span className="truncate">{names.length ? names.slice(0, 3).join("、") + (names.length > 3 ? ` +${names.length - 3}` : "") : chooseLabel}</span>
      <span className="shrink-0 text-xs text-slate-500">{value.length} {selectedLabel}</span>
    </button>
    {open && <Modal title={chooseLabel} onClose={() => setOpen(false)}>
      <div className="overflow-auto p-4"><p className="mb-4 text-sm font-normal text-slate-500">{hint}</p>
        <div role="grid" className="grid grid-cols-2 overflow-hidden rounded-xl border border-slate-200 sm:grid-cols-3 lg:grid-cols-6">{options.map((item) => <label role="gridcell" key={item.code} className="flex min-h-12 cursor-pointer items-center gap-2 border-b border-r p-3 text-sm font-normal hover:bg-emerald-50"><input type="checkbox" checked={pending.includes(item.code)} onChange={() => toggle(item.code)} className="h-4 w-4 shrink-0 accent-emerald-800" /><span>{item[locale]}</span></label>)}</div>
      </div>
      <footer className="flex items-center justify-between border-t p-4"><span>{pending.length} {selectedLabel}</span><div className="flex gap-2"><button type="button" onClick={() => setOpen(false)} className="rounded px-3 py-2">{cancelLabel}</button><button type="button" onClick={() => { onChange(pending); setOpen(false); }} className="rounded bg-emerald-900 px-3 py-2 text-white">{confirmLabel}</button></div></footer>
    </Modal>}

  </div>;
}
