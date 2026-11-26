import { buildKnowledgeGraph, graphDocument } from '../server/knowledge-graph.mjs';
import { buildScenarioAtlas } from './scenario-atlas.mjs';

// Cards contain the same Markdown that was rendered for their compiled detail pages.
// Identity rows may also describe supplementary readings and blocks outside this view.
export function buildContentViews({ cards, identities, origin = 'https://local.invalid' }) {
  const ordered = [...cards].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  const available = new Set(ordered.map(card => card.id));
  const byRef = new Map(identities.map(identity => [identity.ref, identity]));
  const resolve = ref => byRef.get(ref);
  // An item aimed at a block is still a curation line, but only a document
  // can be a member. Preserve the unresolved ref for parseCatalog's diagnostic.
  const resolveDocumentId = ref => {
    const identity = resolve(ref);
    return identity && !identity.anchor ? identity.id : ref;
  };
  const documents = ordered.map(card => ({
    id: card.id, title: card.title,
    ...graphDocument(card, available, origin, resolveDocumentId),
  }));
  return {
    graph: buildKnowledgeGraph(ordered, documents, resolve, ref => resolve(ref)?.id),
    scenarios: buildScenarioAtlas(documents),
  };
}
