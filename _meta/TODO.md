# TODO

Loose follow-ups worth revisiting, separate from PRDs (slice-scoped commitments) and ADRs (decided decisions). Items here are *not* committed work — they are notes to your future self. Promote to an issue or PRD when the question becomes load-bearing.

## Open

No loose follow-ups are currently recorded.

## Retired

### Task-state API sketch

The earlier note about reshaping index-based task mutation was retired by Slice
08. Tasks are now schema-validated artifact data in `tasks.json`; creation goes
through `create_tasks_artifact`, and routine progress goes through
`update_task_status(task_slug, status)`.
