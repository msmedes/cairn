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
  expect(result.html).toContain('<li class="done">Second visible piece</li>');
  expect(result.html).toContain("<li>Third visible piece</li>");
  expect(result.message).toBe("Marked task 2 done.");
});

test("tickTaskHtml marks the first checklist item", () => {
  const result = tickTaskHtml(tasksHtml, 1);

  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.message);
  expect(result.html).toContain('<li class="done">First visible piece</li>');
  expect(result.html).toContain("<li>Second visible piece</li>");
});

test("tickTaskHtml marks the last checklist item", () => {
  const result = tickTaskHtml(tasksHtml, 3);

  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.message);
  expect(result.html).toContain("<li>Second visible piece</li>");
  expect(result.html).toContain('<li class="done">Third visible piece</li>');
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
