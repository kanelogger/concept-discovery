import { cardMatch, cardScope, contentJoin, splitQuery, termMatch } from "./library-scope.mjs";
import { taskDescription, descriptionText } from "./task-description.mjs";
import { mapConcurrent } from "./card-list.mjs";
import { quote, normalize } from "./siyuan.mjs";

const maxCandidates = 8;
const maxEvidenceChars = 2000;

// Read descriptions from the same Markdown used by the editor. Only the
// bounded directory goes to the model; descriptions are retrieval hints.
export async function askCatalog(api, signal) {
  const rows = await api.sql(`SELECT b.id, substr(b.content, 1, 120) AS title
    FROM blocks b WHERE ${cardScope(api.c)} ORDER BY b.id LIMIT 200`, { signal });
  const entries = await mapConcurrent(rows, async row => {
    signal?.throwIfAborted();
    const fullDescription = descriptionText(taskDescription(normalize(await api.markdown(row.id, { signal }))));
    return { id: row.id, title: row.title.trim(), description: fullDescription.slice(0, 600), fullDescription };
  });
  const catalog = [];
  let remaining = 12000;
  for (const entry of entries) {
    if (!entry.title) continue;
    const titleLength = Array.from(entry.title).length;
    if (titleLength > remaining) break;
    const description = Array.from(entry.description).slice(0, remaining - titleLength).join("");
    remaining -= titleLength + Array.from(description).length;
    catalog.push({ ...entry, description });
  }
  return catalog;
}

function snippet(terms) {
  const starts = terms.map(term => {
    const hit = `instr(lower(s.content), lower(${quote(term)}))`;
    return `WHEN ${hit} > 0 THEN max(1, ${hit} - 120)`;
  });
  return `substr(s.content, CASE ${starts.join(" ")} ELSE 1 END, 800)`;
}

export async function askEvidence(api, queries, signal, catalog = []) {
  const scope = cardScope(api.c);
  const candidates = new Map();
  for (const query of queries) {
    signal?.throwIfAborted();
    const terms = splitQuery(query);
    const describedIds = catalog.filter(card => terms.some(term => card.description.toLocaleLowerCase().includes(term.toLocaleLowerCase()))).map(card => card.id);
    const descriptionMatch = describedIds.length ? `b.id IN (${describedIds.map(quote).join(",")})` : "0";
    const rows = await api.sql(`SELECT b.id, substr(b.content, 1, 1000) AS title,
      (${termMatch("b.content", terms)}) AS title_hit,
      (b.content = ${quote(query)}) AS exact_title
      FROM blocks b WHERE ${scope} AND (${cardMatch(terms)} OR ${descriptionMatch})
      ORDER BY exact_title DESC, title_hit DESC, b.id ASC LIMIT 20`, { signal });
    for (const row of rows) {
      const candidate = candidates.get(row.id) ?? { id: row.id, title: row.title, hits: 0, titleHits: 0, exactTitle: 0 };
      candidate.exactTitle = Math.max(candidate.exactTitle, Number(row.exact_title));
      candidate.hits++;
      candidate.titleHits += Number(row.title_hit);
      candidates.set(row.id, candidate);
    }
  }

  const selected = [...candidates.values()]
    .sort((a, b) => b.exactTitle - a.exactTitle || b.titleHits - a.titleHits || b.hits - a.hits || a.id.localeCompare(b.id))
    .slice(0, maxCandidates);
  const terms = [...new Set(queries.flatMap(splitQuery))];
  const cards = [];
  let nextEvidenceId = 1;
  for (const { id, title, exactTitle } of selected) {
    signal?.throwIfAborted();
    const description = catalog.find(card => card.id === id)?.fullDescription ??
      descriptionText(taskDescription(normalize(await api.markdown(id, { signal }))));
    const rows = await api.sql(`SELECT ${snippet(terms)} AS text,
      CASE WHEN d.id <> b.id THEN d.id END AS reading_id,
      CASE WHEN d.id <> b.id THEN substr(d.content, 1, 1000) END AS reading_title
      FROM blocks b ${contentJoin()}
      WHERE b.id = ${quote(id)} AND ${scope}
        AND s.type IN ('p', 'c', 't') AND trim(s.content) <> '' AND s.content <> b.content
      ORDER BY ${exactTitle ? `(d.id = b.id) DESC,
        (s.content LIKE '%assets/%') ASC,
        (s.content LIKE '%kane://%' OR s.content LIKE '%http%') ASC,
        (length(trim(s.content)) < 24) ASC, length(s.content) DESC,` : `(${termMatch("s.content", terms)}) DESC, (${termMatch("d.content", terms)}) DESC,`}
        s.id ASC LIMIT 12`, { signal });
    let remaining = maxEvidenceChars;
    const evidence = [];
    const seen = new Set();
    for (const row of rows) {
      const normalized = row.text.trim().replace(/\s+/g, ' ');
      if (seen.has(normalized) || (description && description.replace(/\s+/g, " ").includes(normalized))) continue;
      seen.add(normalized);
      const characters = Array.from(row.text.trim()).slice(0, remaining);
      if (!characters.length) continue;
      remaining -= characters.length;
      evidence.push({
        id: "e" + nextEvidenceId++,
        text: characters.join(""),
        ...(row.reading_id ? { readingId: row.reading_id, readingTitle: row.reading_title } : {}),
      });
      if (evidence.length === 3) break;
    }
    if (evidence.length) cards.push({ id, title, evidence });
  }
  signal?.throwIfAborted();
  return cards;
}
