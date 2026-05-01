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
const LI_ELEMENT = /<li\b[^>]*>[\s\S]*?<\/li>/gi;
const DONE_CLASS = "done";
const CHECKED_CLASS = "checked";
const UNCHECKED_CLASS = "unchecked";

function countTasks(html: string) {
  return Array.from(html.matchAll(LI_OPEN_TAG)).length;
}

function updateClassAttribute(
  openTag: string,
  updateClasses: (classes: string[]) => string[],
) {
  const classMatch = /\sclass\s*=\s*(["'])(.*?)\1/i.exec(openTag);
  if (!classMatch) {
    const classes = updateClasses([]);
    return openTag.replace(/>$/, ` class="${classes.join(" ")}">`);
  }

  const [attribute, quote, classValue] = classMatch;
  const classes = updateClasses(classValue.split(/\s+/).filter(Boolean));
  const nextAttribute = ` class=${quote}${classes.join(" ")}${quote}`;

  return `${openTag.slice(0, classMatch.index)}${nextAttribute}${openTag.slice(
    classMatch.index + attribute.length,
  )}`;
}

function uniqueClasses(classes: string[]) {
  return Array.from(new Set(classes));
}

function markTaskOpenTagDone(openTag: string) {
  return updateClassAttribute(openTag, (classes) =>
    uniqueClasses([
      ...classes.filter((className) => className !== UNCHECKED_CLASS),
      CHECKED_CLASS,
      DONE_CLASS,
    ]),
  );
}

function markCheckboxInputsDone(html: string) {
  return html.replace(/<input\b[^>]*>/gi, (inputTag) => {
    if (!/\btype\s*=\s*["']?checkbox["']?/i.test(inputTag)) return inputTag;
    if (/\bchecked\b/i.test(inputTag)) return inputTag;
    return inputTag.replace(/>$/, " checked>");
  });
}

function markBoxClassesDone(html: string) {
  return html.replace(/<[a-z][\w:-]*\b[^>]*>/gi, (openTag) => {
    const classMatch = /\sclass\s*=\s*(["'])(.*?)\1/i.exec(openTag);
    const classes = classMatch?.[2].split(/\s+/).filter(Boolean) ?? [];
    if (!classes.includes("box")) return openTag;

    return updateClassAttribute(openTag, (nextClasses) =>
      uniqueClasses([...nextClasses, DONE_CLASS]),
    );
  });
}

function markTaskElementDone(liHtml: string) {
  return markBoxClassesDone(
    markCheckboxInputsDone(
      liHtml.replace(/<li\b[^>]*>/i, (openTag) => markTaskOpenTagDone(openTag)),
    ),
  );
}

function isTaskElementDone(liHtml: string) {
  const openTag = /<li\b[^>]*>/i.exec(liHtml)?.[0] ?? "";
  const classValue = /\sclass\s*=\s*(["'])(.*?)\1/i.exec(openTag)?.[2] ?? "";
  const classes = classValue.split(/\s+/).filter(Boolean);
  if (classes.includes(CHECKED_CLASS) || classes.includes(DONE_CLASS)) {
    return true;
  }

  return Array.from(liHtml.matchAll(/<input\b[^>]*>/gi)).some((input) => {
    const tag = input[0];
    return (
      /\btype\s*=\s*["']?checkbox["']?/i.test(tag) && /\bchecked\b/i.test(tag)
    );
  });
}

function normalizeDoneTaskElements(html: string) {
  return html.replace(LI_ELEMENT, (liHtml) =>
    isTaskElementDone(liHtml) ? markTaskElementDone(liHtml) : liHtml,
  );
}

function taskDoneStates(html: string) {
  return Array.from(html.matchAll(LI_ELEMENT)).map((match) =>
    isTaskElementDone(match[0]),
  );
}

function upsertStyleWidth(openTag: string, width: string) {
  const styleMatch = /\sstyle\s*=\s*(["'])(.*?)\1/i.exec(openTag);
  if (!styleMatch) {
    return openTag.replace(/>$/, ` style="width: ${width};">`);
  }

  const [attribute, quote, styleValue] = styleMatch;
  const withoutWidth = styleValue
    .split(";")
    .map((part) => part.trim())
    .filter((part) => part && !/^width\s*:/i.test(part));
  const nextStyle = [...withoutWidth, `width: ${width}`].join("; ");
  const nextAttribute = ` style=${quote}${nextStyle};${quote}`;

  return `${openTag.slice(0, styleMatch.index)}${nextAttribute}${openTag.slice(
    styleMatch.index + attribute.length,
  )}`;
}

function updateProgress(html: string) {
  const states = taskDoneStates(html);
  if (states.length === 0) return html;

  const doneCount = states.filter(Boolean).length;
  const width = `${Math.round((doneCount / states.length) * 100)}%`;

  return html
    .replace(/<[a-z][\w:-]*\b[^>]*>/gi, (openTag) => {
      const classValue =
        /\sclass\s*=\s*(["'])(.*?)\1/i.exec(openTag)?.[2] ?? "";
      const classes = classValue.split(/\s+/).filter(Boolean);
      const isProgressFill =
        /\bid\s*=\s*(["'])progress-fill\1/i.test(openTag) ||
        classes.includes("progress-bar-fill");

      return isProgressFill ? upsertStyleWidth(openTag, width) : openTag;
    })
    .replace(
      /(<[a-z][\w:-]*\b[^>]*\bid\s*=\s*(["'])progress-label\2[^>]*>)([\s\S]*?)(<\/[a-z][\w:-]*>)/i,
      `$1${doneCount} / ${states.length}$4`,
    );
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
  const nextHtml = html.replace(LI_ELEMENT, (liHtml) => {
    seen += 1;
    return seen === pieceIndex ? markTaskElementDone(liHtml) : liHtml;
  });
  const normalizedHtml = normalizeDoneTaskElements(nextHtml);

  return {
    ok: true,
    html: updateProgress(normalizedHtml),
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
