# Concept Discovery · MVP implementation workspace

This branch implements the MVP in ticket order. Ticket 0023 provides a persistent local Concept draft flow. Remaining P1 tickets and P2–P5 are pending; see [backlog](tasks/backlog.md). The earlier memory-only UI remains on `codex/concept-crud-demo` for reference.

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

Ticket 0023 accepts immutable lowercase slugs and at least one language name. The editor can continue a saved draft and shows Revision versions. Browsing, search, localized WebP media, archive, dashboard, recommendation and Skill flows arrive in later tickets.
