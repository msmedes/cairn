import { describe, expect, test, vi } from "vitest";
import {
  createFrontendDiagnosticPayload,
  recordFrontendConsoleDiagnostic,
} from "./useFrontendDiagnostics";

describe("frontend diagnostics", () => {
  test("creates a sanitized console diagnostic payload", () => {
    const payload = createFrontendDiagnosticPayload("warn", [
      "sidecar-event listen() failed",
      new Error("boom"),
    ]);

    expect(payload).toEqual({
      level: "warn",
      eventName: "console.warn.sidecar.listen_failed",
      message: undefined,
      metadata: {
        argumentCount: 2,
        firstArgumentType: "string",
        messageLength: "sidecar-event listen() failed Error: boom".length,
        signature: "sidecar.listen_failed",
      },
    });
  });

  test("does not emit a frontend diagnostic when diagnostics are disabled", async () => {
    const invoke = vi.fn().mockResolvedValueOnce({
      enabled: false,
      sources: ["frontend"],
      includeText: false,
    });

    await expect(
      recordFrontendConsoleDiagnostic("error", ["hidden"], invoke),
    ).resolves.toBe(false);

    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke).toHaveBeenCalledWith("get_diagnostics_status");
  });

  test("does not emit a frontend diagnostic when frontend source is disabled", async () => {
    const invoke = vi.fn().mockResolvedValueOnce({
      enabled: true,
      sources: ["sidecar", "backend"],
      includeText: false,
    });

    await expect(
      recordFrontendConsoleDiagnostic("error", ["hidden"], invoke),
    ).resolves.toBe(false);

    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke).toHaveBeenCalledWith("get_diagnostics_status");
  });

  test("emits redacted frontend diagnostics through the shared command when enabled", async () => {
    const invoke = vi
      .fn()
      .mockResolvedValueOnce({
        enabled: true,
        sources: ["frontend"],
        includeText: false,
      })
      .mockResolvedValueOnce(true);

    await expect(
      recordFrontendConsoleDiagnostic("error", ["hidden"], invoke),
    ).resolves.toBe(true);

    expect(invoke).toHaveBeenCalledWith("get_diagnostics_status");
    expect(invoke).toHaveBeenCalledWith("record_frontend_diagnostic", {
      payload: {
        level: "error",
        eventName: "console.error",
        message: undefined,
        metadata: {
          argumentCount: 1,
          firstArgumentType: "string",
          messageLength: "hidden".length,
          signature: undefined,
        },
      },
    });
  });

  test("sends raw frontend message only when includeText is enabled", async () => {
    const invoke = vi
      .fn()
      .mockResolvedValueOnce({
        enabled: true,
        sources: ["frontend"],
        includeText: true,
      })
      .mockResolvedValueOnce(true);

    await expect(
      recordFrontendConsoleDiagnostic("error", ["hidden"], invoke),
    ).resolves.toBe(true);

    expect(invoke).toHaveBeenCalledWith("record_frontend_diagnostic", {
      payload: {
        level: "error",
        eventName: "console.error",
        message: "hidden",
        metadata: {
          argumentCount: 1,
          firstArgumentType: "string",
          messageLength: "hidden".length,
          signature: undefined,
        },
      },
    });
  });
});
