import { type InvokeArgs, invoke } from "@tauri-apps/api/core";
import { useEffect } from "react";
import { hasTauriRuntime } from "../../lib/tauri";

type ConsoleLevel = "warn" | "error";

type DiagnosticStatus = {
  enabled: boolean;
  sources: string[];
  includeText: boolean;
};

type FrontendDiagnosticPayload = {
  level: ConsoleLevel;
  eventName: string;
  message?: string;
  metadata: {
    argumentCount: number;
    firstArgumentType?: string;
    messageLength?: number;
    signature?: string;
  };
};

type Invoke = <T>(command: string, args?: InvokeArgs) => Promise<T>;

function argumentType(value: unknown) {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

function messagePart(value: unknown) {
  if (typeof value === "string") return value;
  if (value instanceof Error) return `${value.name}: ${value.message}`;
  if (value === null || value === undefined) return String(value);
  return Object.prototype.toString.call(value);
}

function messageSignature(value: unknown) {
  if (typeof value !== "string") return undefined;
  if (value === "[sidecar error]") return "sidecar.error";
  const knownPrefixes: Array<[string, string]> = [
    ["get_sidecar_dev_logs failed", "devlog.snapshot_failed"],
    ["sidecar-dev-log listen() failed", "devlog.listen_failed"],
    ["read_project_file failed", "project_file.read_failed"],
    ["new_project failed", "project.new_failed"],
    ["menu-event listen failed", "menu.listen_failed"],
    ["[sidecar] unhandled event", "sidecar.unhandled_event"],
    ["get_sidecar_status failed", "sidecar.status_failed"],
    ["sidecar-event listen() failed", "sidecar.listen_failed"],
    ["send_prompt failed", "sidecar.send_prompt_failed"],
    ["open_project failed", "project.open_failed"],
    ["open_project_dialog failed", "project.open_dialog_failed"],
    ["get_mcp_settings failed", "settings.mcp_load_failed"],
    ["set_mcp_server_enabled failed", "settings.mcp_update_failed"],
    ["authenticate_mcp_server failed", "settings.mcp_auth_failed"],
    ["get_cairn_settings failed", "settings.load_failed"],
    ["set_anthropic_api_key failed", "settings.api_key_failed"],
    ["getVersion failed", "settings.version_failed"],
    ["open_cairn_repo failed", "menu.open_repo_failed"],
  ];
  return knownPrefixes.find(([prefix]) => value.startsWith(prefix))?.[1];
}

export function createFrontendDiagnosticPayload(
  level: ConsoleLevel,
  args: unknown[],
  includeText = false,
): FrontendDiagnosticPayload {
  const message = args.map(messagePart).join(" ");
  const signature = messageSignature(args[0]);
  return {
    level,
    eventName: signature ? `console.${level}.${signature}` : `console.${level}`,
    message: includeText ? message : undefined,
    metadata: {
      argumentCount: args.length,
      firstArgumentType: args.length > 0 ? argumentType(args[0]) : undefined,
      messageLength: message.length,
      signature,
    },
  };
}

function canEmitFrontendDiagnostics(status: DiagnosticStatus) {
  return status.enabled && status.sources.includes("frontend");
}

export async function recordFrontendConsoleDiagnostic(
  level: ConsoleLevel,
  args: unknown[],
  invokeFn: Invoke = invoke,
) {
  try {
    const status = await invokeFn<DiagnosticStatus>("get_diagnostics_status");
    if (!canEmitFrontendDiagnostics(status)) return false;
    await invokeFn("record_frontend_diagnostic", {
      payload: createFrontendDiagnosticPayload(level, args, status.includeText),
    });
    return true;
  } catch {
    return false;
  }
}

export function useFrontendDiagnostics() {
  useEffect(() => {
    if (!import.meta.env.DEV || !hasTauriRuntime()) return;

    const originalWarn = console.warn;
    const originalError = console.error;

    console.warn = (...args: unknown[]) => {
      originalWarn(...args);
      void recordFrontendConsoleDiagnostic("warn", args);
    };
    console.error = (...args: unknown[]) => {
      originalError(...args);
      void recordFrontendConsoleDiagnostic("error", args);
    };

    return () => {
      console.warn = originalWarn;
      console.error = originalError;
    };
  }, []);
}
