import { expect, test } from "bun:test";
import { tickTaskHtml } from "../tick-task";

const tasksHtml = `
<main>
  <ol class="task-list">
    <li>First visible piece</li>
    <li>Second visible piece</li>
    <li>Third visible piece</li>
  </ol>
</main>`;

test("tickTaskHtml marks the Nth item done and leaves others alone", () => {
  const result = tickTaskHtml(tasksHtml, 2);

  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.message);
  expect(result.html).toContain("<li>First visible piece</li>");
  expect(result.html).toContain(
    '<li class="checked done">Second visible piece</li>',
  );
  expect(result.html).toContain("<li>Third visible piece</li>");
  expect(result.message).toBe("Marked task 2 done.");
});

test("tickTaskHtml marks the first checklist item", () => {
  const result = tickTaskHtml(tasksHtml, 1);

  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.message);
  expect(result.html).toContain(
    '<li class="checked done">First visible piece</li>',
  );
  expect(result.html).toContain("<li>Second visible piece</li>");
});

test("tickTaskHtml marks the last checklist item", () => {
  const result = tickTaskHtml(tasksHtml, 3);

  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.message);
  expect(result.html).toContain("<li>Second visible piece</li>");
  expect(result.html).toContain(
    '<li class="checked done">Third visible piece</li>',
  );
});

test("tickTaskHtml updates generated visual checkbox task markup", () => {
  const result = tickTaskHtml(
    `
<ul class="task-list">
  <li class="task unchecked" data-issue-path="issues/01-first.md">
    <span class="box" aria-hidden="true"></span>
    <span class="task-text">First piece</span>
  </li>
  <li class="task unchecked" data-issue-path="issues/01-second.md">
    <span class="box" aria-hidden="true"></span>
    <span class="task-text">Second piece</span>
  </li>
</ul>
<div class="progress-bar-fill" id="progress-fill"></div>
<span class="progress-label" id="progress-label">0 / 2</span>`,
    2,
  );

  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.message);
  expect(result.html).toContain('class="task unchecked"');
  expect(result.html).toContain(
    '<li class="task checked done" data-issue-path="issues/01-second.md">',
  );
  expect(result.html).toContain('<span class="box done" aria-hidden="true">');
  expect(result.html).toContain(
    '<div class="progress-bar-fill" id="progress-fill" style="width: 50%;">',
  );
  expect(result.html).toContain(
    '<span class="progress-label" id="progress-label">1 / 2</span>',
  );
});

test("tickTaskHtml normalizes previously done visual tasks", () => {
  const result = tickTaskHtml(
    `
<ul class="task-list">
  <li class="task unchecked done" data-issue-path="issues/01-first.md">
    <span class="box" aria-hidden="true"></span>
    <span class="task-text">First piece</span>
  </li>
  <li class="task unchecked" data-issue-path="issues/01-second.md">
    <span class="box" aria-hidden="true"></span>
    <span class="task-text">Second piece</span>
  </li>
</ul>`,
    2,
  );

  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.message);
  expect(result.html).toContain(
    '<li class="task done checked" data-issue-path="issues/01-first.md">',
  );
  expect(result.html).toContain(
    '<li class="task checked done" data-issue-path="issues/01-second.md">',
  );
  expect(result.html.match(/class="box done"/g)).toHaveLength(2);
});

test("tickTaskHtml checks checkbox inputs when present", () => {
  const result = tickTaskHtml(
    '<ul><li><input type="checkbox">First</li><li><input type="checkbox">Second</li></ul>',
    1,
  );

  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.message);
  expect(result.html).toContain(
    '<li class="checked done"><input type="checkbox" checked>First</li>',
  );
  expect(result.html).toContain('<li><input type="checkbox">Second</li>');
});

test("tickTaskHtml returns structured failure when piece_index is greater than the checklist length", () => {
  const result = tickTaskHtml(tasksHtml, 4);

  expect(result).toEqual({
    ok: false,
    code: "out_of_range",
    message: "Task 4 is out of range. This checklist has 3 tasks.",
    taskCount: 3,
  });
});

test.each([
  0, -1,
])("tickTaskHtml returns structured failure when piece_index is %p", (pieceIndex) => {
  const result = tickTaskHtml(tasksHtml, pieceIndex);

  expect(result).toEqual({
    ok: false,
    code: "out_of_range",
    message: `Task ${pieceIndex} is out of range. Task numbers start at 1.`,
    taskCount: 3,
  });
});

test("tickTaskHtml returns structured failure when piece_index is not an integer", () => {
  const result = tickTaskHtml(tasksHtml, 1.5);

  expect(result).toEqual({
    ok: false,
    code: "out_of_range",
    message: "Task 1.5 is out of range. Task numbers must be whole numbers.",
    taskCount: 3,
  });
});
