import { expect, test } from "bun:test";
import { disambiguate, slugify, withDatePrefix } from "../slug";

test.each([
  ["simple idea", "simple-idea"],
  ["  Build me a Quiz App!  ", "build-me-a-quiz-app"],
  ["", "untitled"],
  ["?!#@$", "untitled"],
  ["Café déjà vu", "cafe-deja-vu"],
  ["a".repeat(90), "a".repeat(64)],
])("slugify(%p) -> %p", (input, expected) => {
  expect(slugify(input)).toBe(expected);
});

test("withDatePrefix uses yyyy-mm-dd and untitled fallback", () => {
  const date = new Date("2026-04-28T19:30:00.000Z");
  expect(withDatePrefix("Quiz Tool", date)).toBe("2026-04-28-quiz-tool");
  expect(withDatePrefix("", date)).toBe("2026-04-28-untitled");
});

test.each([
  ["2026-04-28-quiz-tool", [], "2026-04-28-quiz-tool"],
  ["2026-04-28-quiz-tool", ["2026-04-28-quiz-tool"], "2026-04-28-quiz-tool-2"],
  [
    "2026-04-28-quiz-tool",
    ["2026-04-28-quiz-tool", "2026-04-28-quiz-tool-2"],
    "2026-04-28-quiz-tool-3",
  ],
  ["", ["untitled"], "untitled-2"],
])("disambiguate(%p, %p) -> %p", (slug, existing, expected) => {
  expect(disambiguate(slug, existing)).toBe(expected);
});
