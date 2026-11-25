import { join } from "node:path";
import { canonical, hash } from "../../lib/siyuan.mjs";

export function sourceSnapshot(key, { title, markdown, url = "", author = "", version = 1 }) {
  const payload = { sourceId: "src_" + hash(key).slice(0, 32), title, markdown, url, author };
  return {
    ...payload,
    id: "src_" + hash(canonical(payload)).slice(0, 32),
    hash: hash(markdown),
    version,
    createdAt: "2026-11-01T00:00:00.000Z",
  };
}

export async function syncRawSources(service, sources) {
  const { exportInventory } = await import("../../scripts/raw-export.mjs");
  const rawRoot = join(service.dir, "raw-source-fixtures");
  await exportInventory({
    inventory: { identity: "source-fixture-origin", cards: [], assets: [], relations: [], sources },
    assetsDir: service.dir,
    outputDir: rawRoot,
    origin: service.url,
  });
  await service.raw(rawRoot, "sync");
}
