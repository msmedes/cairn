import { expect, test } from "bun:test";
import { RECAP_THRESHOLD_MS, shouldFireResumeRecap } from "../recap-trigger";

const NOW = Date.parse("2026-04-28T12:00:00.000Z");

test("shouldFireResumeRecap fires only after more than 30 minutes", () => {
  expect(
    shouldFireResumeRecap(
      new Date(NOW - RECAP_THRESHOLD_MS - 1).toISOString(),
      NOW,
      false,
    ),
  ).toEqual({ fire: true });

  expect(
    shouldFireResumeRecap(
      new Date(NOW - RECAP_THRESHOLD_MS + 1).toISOString(),
      NOW,
      false,
    ),
  ).toEqual({ fire: false });

  expect(
    shouldFireResumeRecap(
      new Date(NOW - RECAP_THRESHOLD_MS).toISOString(),
      NOW,
      false,
    ),
  ).toEqual({ fire: false });
});

test("shouldFireResumeRecap does not fire while a turn is still in flight", () => {
  expect(
    shouldFireResumeRecap(
      new Date(NOW - RECAP_THRESHOLD_MS - 1).toISOString(),
      NOW,
      true,
    ),
  ).toEqual({ fire: false });
});

test("shouldFireResumeRecap does not fire for an empty session", () => {
  expect(shouldFireResumeRecap(null, NOW, false)).toEqual({ fire: false });
});
