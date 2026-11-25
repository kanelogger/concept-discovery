# Triage Labels

This project uses the default state label names expected by the `triage` skill. For a triaged task, record exactly one state in a `Status:` line near the top of its Markdown file.

| Canonical state | Local Markdown label |
| --- | --- |
| `needs-triage` | `needs-triage` |
| `needs-info` | `needs-info` |
| `ready-for-agent` | `ready-for-agent` |
| `ready-for-human` | `ready-for-human` |
| `wontfix` | `wontfix` |

`Status:` is the task's triage state. `workflow-state.json.phase` remains the execution phase of the active project task.
