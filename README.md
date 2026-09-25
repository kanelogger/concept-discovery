# Concept Discovery · MVP implementation workspace

This branch implements the MVP in ticket order. The fixed Goal scope is tickets 0023–0029 plus 0031–0040; new backlog entries do not expand it. P1–P4 and 0039 Skill Usage/Feedback are implemented, including the [Concept Discovery Skill](skills/concept-discovery/SKILL.md). The final Eval Gate remains in [backlog](tasks/backlog.md). The earlier memory-only UI remains on `codex/concept-crud-demo` for reference.

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

The editor accepts immutable lowercase slugs and at least one language name, then saves independent names, aliases, descriptions, tags, source text, WebP covers and optional HTTPS Wiki links per language. Save a draft before adding a cover. The Card First library searches only browsable content in the selected language; management shows drafts and missing fields. Archive, Dashboard, Recommendation API and Relation management are available locally.

## Concept Discovery Skill

The project Skill lives at [skills/concept-discovery/SKILL.md](skills/concept-discovery/SKILL.md). For Codex discovery after accepting this demo, link its folder into your personal skills directory, for example `ln -s "$PWD/skills/concept-discovery" "$HOME/.codex/skills/concept-discovery"` from this repository root. This demo does not alter global skills configuration. Invoke `/concept-discovery` or directly ask for applicable Concepts; ordinary tasks do not trigger it. The Skill calls the local recommendation API, shows the result, waits for your selection, then composes and applies the selected Concept to the current task. First remote use requires the interactive `npm run model:configure`; it explains which task content leaves this machine and records the choice in an ignored local `.env`.
