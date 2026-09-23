# Issue tracker: Local Markdown

Project work is tracked in Markdown files under `tasks/`, indexed by `tasks/backlog.md` and coordinated through `workflow-state.json`.

## Conventions

- Create one numbered task file per unit of work using `workflow/task-template.md`.
- Keep the active task pointer and phase in `workflow-state.json`.
- Keep product requirements in `specs/`; keep durable decisions in `docs/adr/`.
- When publishing tickets, create or update task Markdown in `tasks/` and preserve the project workflow.
- For Wayfinder maps and child questions, use task files and existing workflow conventions; do not create a parallel `.scratch/` tree.
- For triage, record one state label in a `Status:` line near the top of the task file. Use the names in `triage-labels.md`; `workflow-state.json` continues to track the active project task and execution phase.
