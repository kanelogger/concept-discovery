# Concept Discovery · Temporary UI Demo

This throwaway UI prototype compares three Concept CRUD layouts on a shared in-memory dataset. It does not connect to a database, model, or backend. Changes reset on reload.

## Run locally

```sh
npm install
npm run demo
```

Open the local URL printed by Vite. The layout switcher is development-only and supports:

- `?variant=A` — Dashboard home, then open the Concept card library
- `?variant=B` — Card First home, with Dashboard as a separate navigation item
- `?variant=C` — Filter, card list, and selected Concept detail/editor workspace

Use the floating switcher or left/right arrow keys to compare layouts. Create, edit, and delete actions update shared React memory state. The state button in the switcher exposes the full current dataset. Dashboard values are sample indicators marked as pending definition.

The editor covers Chinese and English titles, descriptions, and image URLs, plus an optional Wiki URL, tags, and notes. Recommendation Playground, Prompt generation, Relation editing, and Skill execution are out of scope.

This prototype is preserved on branch `codex/concept-crud-demo` for product review; it is not production application code.

Visual tokens, component states, L1 motion, and responsive rules are documented in [DESIGN.md](DESIGN.md). The interface uses Noto Sans SC with Inter fallbacks, semantic CSS color tokens, and normal-flow mobile navigation.
