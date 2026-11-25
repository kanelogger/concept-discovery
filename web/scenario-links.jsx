import { useEffect, useMemo, useState } from "react";
import { atlasTargetHref } from "./routes.mjs";

export function indexAtlasRelations(data) {
  const byCard = new Map();
  const add = (target, items) => {
    for (const { cardId } of items ?? []) {
      if (!byCard.has(cardId)) byCard.set(cardId, { scenes: [], disciplines: [] });
      byCard.get(cardId)[target.view].push(target);
    }
  };
  for (const group of data?.catalog?.groups ?? []) {
    for (const entry of group.entries) {
      add({ view: "scenes", categoryId: group.id, entryId: entry.id, title: entry.title, categoryTitle: group.title }, entry.items);
    }
  }
  for (const discipline of data?.disciplines ?? []) {
    add({ view: "disciplines", categoryId: discipline.id, entryId: discipline.id, title: discipline.title }, discipline.items);
  }
  return byCard;
}

export function ScenarioLinks({ cardId, fromView, relations, focusPrefix, onCrossJump }) {
  if (fromView !== "scenes" && fromView !== "disciplines") return null;
  const targetView = fromView === "scenes" ? "disciplines" : "scenes";
  const items = relations?.[targetView];
  if (!items?.length) return null;
  const label = targetView === "disciplines" ? "所属学科" : "相关问题场景";
  const titles = new Map();
  for (const { title } of items) titles.set(title, (titles.get(title) ?? 0) + 1);
  return <div className="atlas-relations">
    <span className="atlas-relations-label" aria-hidden="true">{label}</span>
    <ul aria-label={label}>
      {items.map(target => {
        const id = `${focusPrefix}-${target.entryId}`;
        return <li key={target.entryId}>
          <a id={id} href={atlasTargetHref(target, cardId)} draggable={false} onClick={event => {
            if (!onCrossJump || event.defaultPrevented || event.button || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
            event.preventDefault();
            void onCrossJump(target, cardId, id);
          }}>{titles.get(target.title) > 1 && target.categoryTitle ? `${target.categoryTitle} · ${target.title}` : target.title}</a>
        </li>;
      })}
    </ul>
  </div>;
}

export function ReaderScenarioLinks({ cardId, fromView, atlasData, readAtlas, onCrossJump }) {
  const [loaded, setLoaded] = useState(null);
  useEffect(() => {
    if (atlasData || !fromView) return;
    const controller = new AbortController();
    void readAtlas(controller.signal).then(data => {
      if (!controller.signal.aborted) setLoaded(data);
    }).catch(() => {});
    return () => controller.abort();
  }, [atlasData, fromView, readAtlas]);
  const relations = useMemo(() => indexAtlasRelations(atlasData ?? loaded).get(cardId), [atlasData, loaded, cardId]);
  return <ScenarioLinks cardId={cardId} fromView={fromView} relations={relations}
    focusPrefix={`atlas-reader-relation-${cardId}`} onCrossJump={onCrossJump} />;
}
