# Concept Discovery · MVP implementation workspace

This branch implements the MVP in ticket order. Tickets 0023–0027 provide persistent Concept drafts, bilingual browsing/search, independent WebP images and Wiki links, per-language recommendation readiness, and inspectable revisions with conflict recovery. Remaining P1 tickets and P2–P5 are pending; see [backlog](tasks/backlog.md). The earlier memory-only UI remains on `codex/concept-crud-demo` for reference.

## Run locally

```sh
npm ci
npm start
```

Open `http://127.0.0.1:4173`. The service stores data in `.local/concept-discovery.sqlite` by default. Set `CONCEPT_DB_PATH` to another file for isolated demos or tests. The Web reads and writes the same Registry API used by the product tests.

```sh
npm run check
npm run demo:build
```

The editor accepts immutable lowercase slugs and at least one language name, then saves independent names, aliases, descriptions, tags, source text, WebP covers and optional HTTPS Wiki links per language. Save a draft before adding a cover. The Card First library searches only browsable content in the selected language; management shows drafts and missing fields. Archive, dashboard, recommendation and Skill flows arrive in later tickets.
