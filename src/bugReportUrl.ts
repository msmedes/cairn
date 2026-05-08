export type BugReportUrlInput = {
  title: string;
  description: string;
  projectName: string | null;
  appVersion: string;
};

const BUG_REPORT_BASE_URL = "https://github.com/msmedes/cairn/issues/new";
const PROJECT_PLACEHOLDER = "No project open";

export function bugReportUrl({
  title,
  description,
  projectName,
  appVersion,
}: BugReportUrlInput) {
  const displayProjectName = projectName?.trim() || PROJECT_PLACEHOLDER;
  const body = [
    "## What happened",
    "",
    description,
    "",
    "## Context",
    "",
    `- App version: ${appVersion}`,
    `- Active project: ${displayProjectName}`,
    "",
    "The bug report zip is ready in Finder. Drag it into this issue before submitting.",
  ].join("\n");

  return [
    BUG_REPORT_BASE_URL,
    "?title=",
    encodeURIComponent(title),
    "&body=",
    encodeURIComponent(body),
    "&labels=",
    encodeURIComponent("bug"),
  ].join("");
}
