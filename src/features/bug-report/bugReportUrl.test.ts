import { describe, expect, test } from "vitest";
import { bugReportUrl } from "./bugReportUrl";

describe("bugReportUrl", () => {
  test("builds a prefilled GitHub bug issue URL", () => {
    const url = bugReportUrl({
      title: "Artifact does not update",
      description: "The Plan tab stayed stale after the Cairn finished.",
      projectName: "Training Quiz",
      appVersion: "0.1.0",
    });
    const parsed = new URL(url);

    expect(parsed.origin + parsed.pathname).toBe(
      "https://github.com/msmedes/cairn/issues/new",
    );
    expect(parsed.searchParams.get("title")).toBe("Artifact does not update");
    expect(parsed.searchParams.get("labels")).toBe("bug");
    expect(parsed.searchParams.get("body")).toContain(
      "The Plan tab stayed stale",
    );
    expect(parsed.searchParams.get("body")).toContain("Training Quiz");
    expect(parsed.searchParams.get("body")).toContain("0.1.0");
    expect(parsed.searchParams.get("body")).toContain(
      "Attach any screenshots directly to this GitHub issue",
    );
  });

  test("round-trips special characters through decodeURIComponent", () => {
    const url = bugReportUrl({
      title: "Ampersand & unicode ✓",
      description: "Line one\nLine two & more = yes?",
      projectName: "Café Project",
      appVersion: "0.1.0-beta+dev",
    });
    const query = url.split("?")[1];
    const params = Object.fromEntries(
      query.split("&").map((part) => {
        const [key, value] = part.split("=");
        return [key, decodeURIComponent(value)];
      }),
    );

    expect(params.title).toBe("Ampersand & unicode ✓");
    expect(params.body).toContain("Line one\nLine two & more = yes?");
    expect(params.body).toContain("Café Project");
    expect(params.labels).toBe("bug");
  });

  test("uses a placeholder project name instead of emitting null", () => {
    const url = bugReportUrl({
      title: "Startup crash",
      description: "The app failed before a project opened.",
      projectName: null,
      appVersion: "0.1.0",
    });
    const body = new URL(url).searchParams.get("body") ?? "";

    expect(body).toContain("No project open");
    expect(body).not.toContain("null");
  });
});
