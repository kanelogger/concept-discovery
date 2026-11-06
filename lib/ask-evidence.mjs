import { cardMatch, cardScope, contentJoin, splitQuery, termMatch } from "./library-scope.mjs";
import { quote } from "./siyuan.mjs";

const maxCandidates = 8;
const maxEvidenceChars = 2000;

function snippet(terms) {
  const starts = terms.map(term => {
    const hit = `instr(lower(s.content), lower(${quote(term)}))`;
    return `WHEN ${hit} > 0 THEN max(1, ${hit} - 120)`;
  });
  return `substr(s.content, CASE ${starts.join(" ")} ELSE 1 END, 800)`;
}

export async function askEvidence(api, queries, signal) {
  const scope = cardScope(api.c);
  const candidates = new Map();
  for (const query of queries) {
    signal?.throwIfAborted();
    const terms = splitQuery(query);
    const rows = await api.sql(`SELECT b.id, substr(b.content, 1, 1000) AS title,
      (${termMatch("b.content", terms)}) AS title_hit
      FROM blocks b WHERE ${scope} AND ${cardMatch(terms)}
      ORDER BY title_hit DESC, b.id ASC LIMIT 20`, { signal });
    for (const row of rows) {
      const candidate = candidates.get(row.id) ?? { id: row.id, title: row.title, hits: 0, titleHits: 0 };
      candidate.hits++;
      candidate.titleHits += Number(row.title_hit);
      candidates.set(row.id, candidate);
    }
  }

  const selected = [...candidates.values()]
    .sort((a, b) => b.hits - a.hits || b.titleHits - a.titleHits || a.id.localeCompare(b.id))
    .slice(0, maxCandidates);
  const terms = [...new Set(queries.flatMap(splitQuery))];
  const cards = [];
  let nextEvidenceId = 1;
  for (const { id, title } of selected) {
    signal?.throwIfAborted();
    const rows = await api.sql(`SELECT ${snippet(terms)} AS text,
      CASE WHEN d.id <> b.id THEN d.id END AS reading_id,
      CASE WHEN d.id <> b.id THEN substr(d.content, 1, 1000) END AS reading_title
      FROM blocks b ${contentJoin()}
      WHERE b.id = ${quote(id)} AND ${scope}
        AND s.type IN ('p', 'h', 'c', 't') AND trim(s.content) <> ''
      ORDER BY (${termMatch("s.content", terms)}) DESC, (${termMatch("d.content", terms)}) DESC,
        (s.type = 'h') ASC, s.id ASC LIMIT 3`, { signal });
    let remaining = maxEvidenceChars;
    const evidence = [];
    for (const row of rows) {
      const characters = Array.from(row.text.trim()).slice(0, remaining);
      if (!characters.length) continue;
      remaining -= characters.length;
      evidence.push({
        id: "e" + nextEvidenceId++,
        text: characters.join(""),
        ...(row.reading_id ? { readingId: row.reading_id, readingTitle: row.reading_title } : {}),
      });
    }
    if (evidence.length) cards.push({ id, title, evidence });
  }
  signal?.throwIfAborted();
  return cards;
}
