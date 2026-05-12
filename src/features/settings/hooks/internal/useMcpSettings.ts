import { invoke } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";
import { hasTauriRuntime } from "../../../../lib/tauri";
import type {
  McpServerKey,
  McpSettingsStatus,
} from "../../components/SettingsPanel";

type UseMcpSettingsArgs = {
  activeProjectPath: string | null;
  authenticateMcpServer: (server: McpServerKey) => Promise<void>;
};

export function useMcpSettings({
  activeProjectPath,
  authenticateMcpServer,
}: UseMcpSettingsArgs) {
  const [mcpStatus, setMcpStatus] = useState<McpSettingsStatus | null>(null);
  const [mcpMessage, setMcpMessage] = useState<string | null>(null);
  const [updatingMcpServer, setUpdatingMcpServer] =
    useState<McpServerKey | null>(null);

  useEffect(() => {
    if (!hasTauriRuntime()) return;

    let cancelled = false;
    invoke<McpSettingsStatus>("get_mcp_settings", {
      projectPath: activeProjectPath,
    })
      .then((status) => {
        if (!cancelled) setMcpStatus(status);
      })
      .catch((err) => {
        console.error("get_mcp_settings failed", err);
        if (!cancelled) setMcpMessage("Could not load MCP settings.");
      });

    return () => {
      cancelled = true;
    };
  }, [activeProjectPath]);

  async function setMcpServerEnabled(server: McpServerKey, enabled: boolean) {
    if (updatingMcpServer) return;

    setUpdatingMcpServer(server);
    setMcpMessage(null);
    try {
      const next = await invoke<McpSettingsStatus>("set_mcp_server_enabled", {
        server,
        enabled,
      });
      setMcpStatus(next);
      setMcpMessage(enabled ? "MCP server added." : "MCP server removed.");
    } catch (err) {
      console.error("set_mcp_server_enabled failed", err);
      setMcpMessage("Could not update MCP settings.");
    } finally {
      setUpdatingMcpServer(null);
    }
  }

  async function requestMcpAuth(server: McpServerKey) {
    setMcpMessage(`Opening ${server} OAuth in your browser...`);
    try {
      await authenticateMcpServer(server);
    } catch (err) {
      console.error("authenticate_mcp_server failed", err);
      setMcpMessage(`Could not start ${server} OAuth.`);
    }
  }

  return {
    mcpStatus,
    mcpMessage,
    updatingMcpServer,
    setMcpMessage,
    setMcpServerEnabled,
    requestMcpAuth,
  };
}
