import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export type TickTaskResult =
  | { ok: true; message: string }
  | {
      ok: false;
      code: "no_active_project" | "tasks_not_found" | "out_of_range";
      message: string;
      taskCount?: number;
    };

export type TickTaskHtmlResult =
  | { ok: true; html: string; message: string }
  | Extract<TickTaskResult, { ok: false }>;

const LI_OPEN_TAG = /<li\b[^>]*>/gi;
const DONE_CLASS = "done";

function countTasks(html: string) {
  return Array.from(html.matchAll(LI_OPEN_TAG)).length;
}

function addDoneClass(openTag: string) {
  const classMatch = /\sclass\s*=\s*(["'])(.*?)\1/i.exec(openTag);
  if (!classMatch?.index) {
    return openTag.replace(/>$/, ` class="${DONE_CLASS}">`);
  }

  const [attribute, quote, classValue] = classMatch;
  const classes = classValue.split(/\s+/).filter(Boolean);
  if (classes.includes(DONE_CLASS)) return openTag;

  const nextAttribute = ` class=${quote}${[...classes, DONE_CLASS].join(" ")}${quote}`;
  return `${openTag.slice(0, classMatch.index)}${nextAttribute}${openTag.slice(
    classMatch.index + attribute.length,
  )}`;
}

export function tickTaskHtml(
  html: string,
  pieceIndex: number,
): TickTaskHtmlResult {
  const taskCount = countTasks(html);

  if (pieceIndex <= 0) {
    return {
      ok: false,
      code: "out_of_range",
      message: `Task ${pieceIndex} is out of range. Task numbers start at 1.`,
      taskCount,
    };
  }

  if (!Number.isInteger(pieceIndex)) {
    return {
      ok: false,
      code: "out_of_range",
      message: `Task ${pieceIndex} is out of range. Task numbers must be whole numbers.`,
      taskCount,
    };
  }

  if (pieceIndex > taskCount) {
    return {
      ok: false,
      code: "out_of_range",
      message: `Task ${pieceIndex} is out of range. This checklist has ${taskCount} tasks.`,
      taskCount,
    };
  }

  let seen = 0;
  const nextHtml = html.replace(LI_OPEN_TAG, (openTag) => {
    seen += 1;
    return seen === pieceIndex ? addDoneClass(openTag) : openTag;
  });

  return {
    ok: true,
    html: nextHtml,
    message: `Marked task ${pieceIndex} done.`,
  };
}

export function tickTaskInProject(input: {
  projectRoot: string;
  pieceIndex: number;
}): TickTaskResult {
  const tasksPath = join(input.projectRoot, "tasks.html");

  let html: string;
  try {
    html = readFileSync(tasksPath, "utf8");
  } catch {
    return {
      ok: false,
      code: "tasks_not_found",
      message: "I could not find the Tasks tab for this project.",
    };
  }

  const result = tickTaskHtml(html, input.pieceIndex);
  if (!result.ok) return result;

  writeFileSync(tasksPath, result.html, "utf8");
  return { ok: true, message: result.message };
}
