# TODO

Loose follow-ups worth revisiting, separate from PRDs (slice-scoped commitments) and ADRs (decided decisions). Items here are *not* committed work — they are notes to your future self. Promote to an issue or PRD when the question becomes load-bearing.

## Open

### Reshape `tick_task` into a generalized task-state API

PRD 07 ships `tick_task(piece_index)` as a small direct tool that flips the Nth checkbox in `<project>/tasks.html`. The initial creation of `tasks.html` (with all checkboxes unchecked) goes through a separate path: `spawn_subagent("write-tasks", …)`.

Worth considering once 07 lands and we have it in hand: collapse both into a single task-state tool family. Sketch:

- `create_task(steps)` — write the initial task list (replacing the `spawn_subagent("write-tasks", …)` path, since the create step is closer to a state mutation than to artifact generation in spirit).
- `update_task(task, step)` — flip the Nth step in the named task list (replaces `tick_task`).
- Maybe `update_task` takes a callback that fires on the transition — useful if e.g. completion of the last step should trigger something.

Open questions to think through before promoting:

- Does `task` need to be addressable by id (allowing future multiple task lists per project), or is it always implicitly the active project's `tasks.html` for v0?
- What does the callback mechanism actually look like in pi.dev's tool-call shape — return value, separate event, or something else?
- Does this collapse mean the `write-tasks` skill goes away, or does the skill move behind `create_task`?

Defer until PRD 07 has shipped and `tick_task` has been used for real. If the new shape feels right after that, write it up as a PRD.
