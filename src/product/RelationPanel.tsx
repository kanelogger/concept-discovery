import { useEffect, useState } from "react";

type Locale = "cn" | "en";
type RelationType = "related_to" | "often_used_with" | "contrasts_with" | "extends" | "part_of";
import type { RelationView } from "./model";
import Modal from "./Modal";
type RelationRecord = { id: number; source_concept_id: string; target_concept_id: string; relation_type: RelationType; note: Record<Locale, string>; version: number };
type Option = { id: string; lifecycle_status: "active" | "archived"; locales: Record<Locale, { name: string }> };

const typeNames: Record<RelationType, Record<Locale, string>> = {
  related_to: { cn: "相关概念", en: "Related to" },
  often_used_with: { cn: "经常一起使用", en: "Often used with" },
  contrasts_with: { cn: "形成对照", en: "Contrasts with" },
  extends: { cn: "扩展", en: "Extends" },
  part_of: { cn: "属于", en: "Part of" },
};

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, { ...init, headers: { "Content-Type": "application/json", ...init?.headers } });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.message || "Relation request failed");
  return payload as T;
}

export default function RelationPanel({ conceptId, lifecycleStatus, locale, manage, refreshKey, onOpenConcept, onChanged }: {
  conceptId: string; lifecycleStatus: "active" | "archived"; locale: Locale; manage: boolean; refreshKey: number; onOpenConcept: (id: string) => void; onChanged: () => void;
}) {
  const [relations, setRelations] = useState<RelationView[]>([]);
  const [options, setOptions] = useState<Option[]>([]);
  const [editing, setEditing] = useState<RelationRecord | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [targetId, setTargetId] = useState("");
  const [relationType, setRelationType] = useState<RelationType>("related_to");
  const [noteCn, setNoteCn] = useState("");
  const [noteEn, setNoteEn] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [revision, setRevision] = useState(0);
  const [pendingRemoval, setPendingRemoval] = useState<RelationView | null>(null);

  useEffect(() => { setFormOpen(false); setEditing(null); setError(""); }, [conceptId]);

  useEffect(() => {
    let cancelled = false;
    setRelations([]);
    api<{ relations: RelationView[] }>(`/api/concepts/${encodeURIComponent(conceptId)}/relations?locale=${locale}`)
      .then((result) => { if (!cancelled) { setRelations(result.relations); setError(""); } })
      .catch((cause) => { if (!cancelled) setError(cause instanceof Error ? cause.message : "Relations failed to load"); });
    return () => { cancelled = true; };
  }, [conceptId, locale, refreshKey, revision]);

  useEffect(() => {
    if (!manage) return;
    let cancelled = false;
    api<{ concepts: Option[] }>(`/api/concepts?locale=${locale}&view=manage&status=all`)
      .then((result) => { if (!cancelled) setOptions(result.concepts); })
      .catch((cause) => { if (!cancelled) setError(cause instanceof Error ? cause.message : "Concept options failed to load"); });
    return () => { cancelled = true; };
  }, [manage, locale, refreshKey, revision]);

  const openCreate = () => {
    setEditing(null); setTargetId(""); setRelationType("related_to"); setNoteCn(""); setNoteEn(""); setError(""); setFormOpen(true);
  };
  const openEdit = async (id: number) => {
    try {
      const record = await api<RelationRecord>(`/api/relations/${id}`);
      setEditing(record); setRelationType(record.relation_type); setNoteCn(record.note.cn); setNoteEn(record.note.en); setError(""); setFormOpen(true);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Relation failed to load"); }
  };
  const save = async (event: React.FormEvent) => {
    event.preventDefault(); setBusy(true); setError("");
    try {
      if (editing) await api(`/api/relations/${editing.id}`, { method: "PATCH", body: JSON.stringify({ expected_version: editing.version, changes: { relation_type: relationType, note: { cn: noteCn, en: noteEn } } }) });
      else await api("/api/relations", { method: "POST", body: JSON.stringify({ source_concept_id: conceptId, target_concept_id: targetId, relation_type: relationType, note: { cn: noteCn, en: noteEn } }) });
      setFormOpen(false); setEditing(null); setRevision((value) => value + 1); onChanged();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Relation save failed"); }
    finally { setBusy(false); }
  };
  const remove = async () => {
    if (!pendingRemoval) return;
    const relation = pendingRemoval;
    setBusy(true); setError("");
    try {
      await api(`/api/relations/${relation.id}`, { method: "DELETE", body: JSON.stringify({ expected_version: relation.version }) });
      setPendingRemoval(null); setRevision((value) => value + 1); onChanged();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Relation removal failed"); }
    finally { setBusy(false); }
  };
  const label = (relation: RelationView) => {
    if (relation.direction === "incoming" && relation.relation_type === "extends") return locale === "cn" ? "被扩展" : "Extended by";
    if (relation.direction === "incoming" && relation.relation_type === "part_of") return locale === "cn" ? "包含" : "Has part";
    return typeNames[relation.relation_type][locale];
  };

  const grouped = Object.keys(typeNames).flatMap((type) => relations.filter((relation) => relation.relation_type === type));

  return <><section className="mt-8 border-t border-slate-200 pt-7" aria-label={locale === "cn" ? "Concept 关系" : "Concept relations"}>
    <div className="flex flex-wrap items-center justify-between gap-3"><div><p className="font-mono text-[10px] font-semibold uppercase tracking-[.12em] text-signal-800">FOLLOW THE THREAD</p><h3 className="mt-1 font-display text-xl font-semibold text-ink">{locale === "cn" ? "概念关系" : "Concept relations"}</h3></div>{manage && lifecycleStatus === "active" && <button type="button" onClick={openCreate} className="min-h-11 rounded-lg border border-brand-200 bg-white px-4 text-sm font-semibold text-brand-800 hover:bg-brand-50">{locale === "cn" ? "添加关系" : "Add relation"}</button>}</div>
    {relations.length === 0 && <p className="mt-4 rounded-lg border border-dashed border-slate-300 p-4 text-sm text-slate-600">{locale === "cn" ? "暂无关系" : "No relations yet"}</p>}
    <div className="mt-4 space-y-3">{grouped.map((relation) => <div key={relation.id} className="rounded-xl border border-slate-200 bg-surface-soft p-4 sm:p-5"><div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0"><p className="font-mono text-[10px] font-semibold uppercase tracking-[.1em] text-slate-600">{label(relation)} · {relation.direction === "symmetric" ? "↔" : relation.direction === "outgoing" ? "→" : "←"}</p>{relation.other.status === "active" && relation.other.browsable ? <button type="button" onClick={() => onOpenConcept(relation.other.id)} className="mt-2 min-h-10 font-display text-lg font-semibold text-brand-800 underline decoration-brand-200 underline-offset-4">{relation.other.name || relation.other.id}</button> : <p className="mt-2 font-display text-lg font-semibold text-ink">{relation.other.name || relation.other.id}</p>}{relation.other.status === "archived" && <p className="mt-1 text-sm text-amber-800">{locale === "cn" ? "已归档" : "Archived"}</p>}{relation.other.status === "missing" && <p className="mt-1 text-sm text-rose-800">{locale === "cn" ? "目标缺失" : "Target missing"}</p>}{relation.other.status === "active" && !relation.other.browsable && <p className="mt-1 text-sm text-amber-800">{locale === "cn" ? "当前语言内容待补" : "Content pending in this language"}</p>}{!relation.other.name && relation.other.status !== "missing" && <p className="mt-1 text-sm text-slate-600">{locale === "cn" ? "当前语言未命名" : "No name in this language"}</p>}</div>{manage && <div className="flex gap-2"><button type="button" onClick={() => openEdit(relation.id)} className="min-h-10 rounded-md px-3 text-sm font-semibold text-brand-800 underline">{locale === "cn" ? "编辑" : "Edit"}</button><button type="button" disabled={busy} onClick={() => setPendingRemoval(relation)} className="min-h-10 rounded-md px-3 text-sm font-semibold text-rose-800 underline disabled:opacity-50">{locale === "cn" ? "移除" : "Remove"}</button></div>}</div>{relation.note && <p className="mt-3 border-t border-slate-200 pt-3 whitespace-pre-wrap text-sm leading-6 text-slate-700">{relation.note}</p>}</div>)}</div>
    {error && <p role="alert" className="mt-4 rounded-lg bg-rose-50 p-3 text-sm text-rose-800">{error}</p>}
    {formOpen && <form onSubmit={save} className="mt-5 space-y-4 rounded-xl border border-brand-200 bg-brand-50/40 p-4 sm:p-5"><h4 className="font-display text-lg font-semibold text-ink">{editing ? (locale === "cn" ? "编辑关系" : "Edit relation") : (locale === "cn" ? "添加关系" : "Add relation")}</h4>{editing ? <p className="font-mono text-xs text-slate-700">{editing.source_concept_id} → {editing.target_concept_id}</p> : <label className="block text-sm font-semibold text-slate-700">{locale === "cn" ? "目标 Concept" : "Target Concept"}<select required value={targetId} onChange={(event) => setTargetId(event.target.value)} className="mt-1 block min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"><option value="">{locale === "cn" ? "请选择" : "Select"}</option>{options.filter((option) => option.id !== conceptId && option.lifecycle_status === "active").map((option) => <option key={option.id} value={option.id}>{option.locales[locale].name || option.id}</option>)}</select></label>}<label className="block text-sm font-semibold text-slate-700">{locale === "cn" ? "关系类型" : "Relation type"}<select value={relationType} onChange={(event) => setRelationType(event.target.value as RelationType)} className="mt-1 block min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm">{(Object.keys(typeNames) as RelationType[]).map((type) => <option key={type} value={type}>{typeNames[type][locale]}</option>)}</select></label><div className="grid gap-3 sm:grid-cols-2"><label className="block text-sm font-semibold text-slate-700">中文备注<textarea value={noteCn} onChange={(event) => setNoteCn(event.target.value)} rows={2} className="mt-1 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-normal" /></label><label className="block text-sm font-semibold text-slate-700">English note<textarea value={noteEn} onChange={(event) => setNoteEn(event.target.value)} rows={2} className="mt-1 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-normal" /></label></div><div className="flex justify-end gap-2"><button type="button" onClick={() => { setFormOpen(false); setError(""); }} className="min-h-11 rounded-lg px-4 text-sm font-semibold text-slate-700">{locale === "cn" ? "取消" : "Cancel"}</button><button type="submit" disabled={busy} className="min-h-11 rounded-lg bg-brand-900 px-4 text-sm font-semibold text-white disabled:opacity-50">{busy ? "Saving…" : locale === "cn" ? "保存关系" : "Save relation"}</button></div></form>}
  </section>{pendingRemoval && <Modal title={locale === "cn" ? "移除 Concept 关系" : "Remove Concept relation"} onClose={() => setPendingRemoval(null)} className="max-w-md"><div className="p-6"><p className="font-semibold text-ink">{pendingRemoval.other.name || pendingRemoval.other.id}</p><p className="mt-3 text-sm leading-7 text-slate-700">{locale === "cn" ? "这只会移除两个 Concept 之间的关系，不会删除任何 Concept。" : "This removes the relation between the Concepts. It does not delete either Concept."}</p>{error && <p role="alert" className="mt-3 text-sm text-rose-800">{error}</p>}<div className="mt-6 flex justify-end gap-2"><button type="button" onClick={() => setPendingRemoval(null)} className="min-h-11 rounded-lg border border-slate-300 px-4 text-sm font-semibold text-slate-800">{locale === "cn" ? "取消" : "Cancel"}</button><button type="button" disabled={busy} onClick={() => void remove()} className="min-h-11 rounded-lg bg-rose-800 px-4 text-sm font-semibold text-white disabled:opacity-50">{locale === "cn" ? "移除关系" : "Remove relation"}</button></div></div></Modal>}</>;
}
