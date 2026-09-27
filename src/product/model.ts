export type Locale = "cn" | "en";
export type LocaleData = {
  name: string; aliases: string[]; description: string; cover_image: string; cover_images: string[]; wiki_url: string;
  tags: string[]; trigger: string[]; questions: string[]; examples: string[]; avoid_when: string[]; transform: string[];
  agent_instruction: string; source_text: string;
};
export type Readiness = { browsable: boolean; recommendable: boolean; browse_missing: string[]; recommend_missing: string[] };
export type RelationView = {
  id: number; source_concept_id: string; target_concept_id: string;
  relation_type: "related_to" | "often_used_with" | "contrasts_with" | "extends" | "part_of";
  direction: "symmetric" | "outgoing" | "incoming"; note: string; version: number;
  other: { id: string; name: string | null; status: "active" | "archived" | "missing"; browsable: boolean };
};
export type Concept = {
  relation_preview?: RelationView[];
  id: string; lifecycle_status: "active" | "archived"; interaction_type: string | null;
  epistemic_type: string | null; domains: string[]; intents: string[];
  locales: Record<Locale, LocaleData>; version: number; created_at: string; updated_at: string;
  readiness: Record<Locale, Readiness>;
};
export type Draft = {
  id: string; cnName: string; enName: string; cnAliases: string; enAliases: string;
  cnDescription: string; enDescription: string; cnSource: string; enSource: string;
  cnTags: string; enTags: string; cnWiki: string; enWiki: string;
  cnTrigger: string[]; enTrigger: string[]; cnAvoid: string[]; enAvoid: string[];
  cnQuestions: string[]; enQuestions: string[]; cnExamples: string[]; enExamples: string[];
  cnTransform: string[]; enTransform: string[]; cnInstruction: string; enInstruction: string;
  interactionType: string; epistemicType: string;
  domains: string[]; intents: string[];
};
export type DashboardData = {
  active_total: number; both_draft: number; archived_total: number;
  locales: Record<Locale, { browsable: number; recommendable: number }>;
  recent_revisions: { revision_id: number; concept_id: string; version: number; operation: string; changed_at: string; affected_languages: Locale[]; shared_changes: boolean; changed_paths: string[] }[];
  usage: { runs_total: number; none_runs: number; events: Record<"recommended" | "viewed" | "applied" | "ignored" | "not_useful", number>; locales: Record<Locale, { runs_total: number; none_runs: number; events: Record<"recommended" | "viewed" | "applied" | "ignored" | "not_useful", number> }> };
};
export type MediaDraftItem = { kind: "existing"; hash: string } | { kind: "new"; id: string; data: string; preview: string; fileName: string };
export type MediaDraft = MediaDraftItem[] | null;

export const blank: Draft = {
  id: "", cnName: "", enName: "", cnAliases: "", enAliases: "", cnDescription: "", enDescription: "",
  cnSource: "", enSource: "", cnTags: "", enTags: "", cnWiki: "", enWiki: "",
  cnTrigger: [], enTrigger: [], cnAvoid: [], enAvoid: [], cnTransform: [], enTransform: [],
  cnQuestions: [], enQuestions: [], cnExamples: [], enExamples: [],
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
  "locales.cn.trigger": draft.cnTrigger, "locales.en.trigger": draft.enTrigger,
  "locales.cn.avoid_when": draft.cnAvoid, "locales.en.avoid_when": draft.enAvoid,
  "locales.cn.transform": draft.cnTransform, "locales.en.transform": draft.enTransform,
  "locales.cn.questions": draft.cnQuestions, "locales.en.questions": draft.enQuestions,
  "locales.cn.examples": draft.cnExamples, "locales.en.examples": draft.enExamples,
  "locales.cn.agent_instruction": draft.cnInstruction, "locales.en.agent_instruction": draft.enInstruction,
  interaction_type: draft.interactionType || null, epistemic_type: draft.epistemicType || null,
  domains: draft.domains, intents: draft.intents,
});
export const fromConcept = (concept: Concept): Draft => ({
  id: concept.id,
  cnName: concept.locales.cn.name, enName: concept.locales.en.name,
  cnAliases: concept.locales.cn.aliases.join(", "), enAliases: concept.locales.en.aliases.join(", "),
  cnDescription: concept.locales.cn.description, enDescription: concept.locales.en.description,
  cnSource: concept.locales.cn.source_text, enSource: concept.locales.en.source_text,
  cnTags: concept.locales.cn.tags.join(", "), enTags: concept.locales.en.tags.join(", "),
  cnWiki: concept.locales.cn.wiki_url, enWiki: concept.locales.en.wiki_url,
  cnTrigger: [...concept.locales.cn.trigger], enTrigger: [...concept.locales.en.trigger],
  cnAvoid: [...concept.locales.cn.avoid_when], enAvoid: [...concept.locales.en.avoid_when],
  cnTransform: [...concept.locales.cn.transform], enTransform: [...concept.locales.en.transform],
  cnQuestions: [...(concept.locales.cn.questions ?? [])], enQuestions: [...(concept.locales.en.questions ?? [])],
  cnExamples: [...(concept.locales.cn.examples ?? [])], enExamples: [...(concept.locales.en.examples ?? [])],
  cnInstruction: concept.locales.cn.agent_instruction, enInstruction: concept.locales.en.agent_instruction,
  interactionType: concept.interaction_type ?? "", epistemicType: concept.epistemic_type ?? "",
  domains: [...concept.domains], intents: [...concept.intents],
});

export const storedImages = (data: LocaleData): string[] => data.cover_images?.length ? data.cover_images : data.cover_image ? [data.cover_image] : [];
const mediaPayload = (media: Record<Locale, MediaDraft>) => Object.fromEntries((["cn", "en"] as const).filter((language) => media[language] !== null).map((language) => [language, {
  action: "sync", images: (media[language] ?? []).map((item) => item.kind === "existing" ? { hash: item.hash } : { data: item.data }),
}]));

export function updatePayload(concept: Concept, draft: Draft, media: Record<Locale, MediaDraft>) {
  const values = formValues(draft);
  const previous = formValues(fromConcept(concept));
  const changes = Object.fromEntries(Object.entries(values).filter(([path, value]) => JSON.stringify(value) !== JSON.stringify(previous[path])));
  return { expected_version: concept.version, changes, media: mediaPayload(media) };
}

export function createPayload(draft: Draft, preview = false, media?: Record<Locale, MediaDraft>) {
  const values = formValues(draft);
  const localeValues = (language: Locale) => Object.fromEntries(Object.entries(values).filter(([path]) => path.startsWith(`locales.${language}.`)).map(([path, value]) => [path.slice(11), value]));
  return { id: preview && !draft.id ? "preview-draft" : draft.id, interaction_type: values.interaction_type, epistemic_type: values.epistemic_type, domains: values.domains, intents: values.intents, locales: { cn: localeValues("cn"), en: localeValues("en") }, ...(media ? { media: mediaPayload(media) } : {}) };
}
