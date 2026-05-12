import { getVersion } from "@tauri-apps/api/app";
import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useState } from "react";
import { hasTauriRuntime } from "../../../lib/tauri";
import type {
  CairnSettingsStatus,
  McpServerKey,
  McpSettingsStatus,
} from "../components/SettingsPanel";

type UseSettingsBridgeArgs = {
  activeProjectPath: string | null;
  authenticateMcpServer: (server: McpServerKey) => Promise<void>;
};

export function useSettingsBridge({
  activeProjectPath,
  authenticateMcpServer,
}: UseSettingsBridgeArgs) {
  const [settingsStatus, setSettingsStatus] =
    useState<CairnSettingsStatus | null>(null);
  const [apiKeyInput, setApiKeyInput] = useState("");
  const [settingsMessage, setSettingsMessage] = useState<string | null>(null);
  const [savingApiKey, setSavingApiKey] = useState(false);
  const [mcpStatus, setMcpStatus] = useState<McpSettingsStatus | null>(null);
  const [mcpMessage, setMcpMessage] = useState<string | null>(null);
  const [updatingMcpServer, setUpdatingMcpServer] =
    useState<McpServerKey | null>(null);
  const [appVersion, setAppVersion] = useState("unknown");
  const [settingsPanelOpen, setSettingsPanelOpen] = useState(false);

  const openSettingsPanel = useCallback(() => {
    setSettingsPanelOpen(true);
    setSettingsMessage(null);
    setMcpMessage(null);
  }, []);

  const closeSettingsPanel = useCallback(() => {
    setSettingsPanelOpen(false);
  }, []);

  useEffect(() => {
    if (!hasTauriRuntime()) return;

    let cancelled = false;
    invoke<CairnSettingsStatus>("get_cairn_settings")
      .then((status) => {
        if (cancelled) return;
        setSettingsStatus(status);
        if (!status.hasAnthropicApiKey) {
          setSettingsPanelOpen(true);
        }
      })
      .catch((err) => {
        console.error("get_cairn_settings failed", err);
      });

    return () => {
      cancelled = true;
    };
  }, []);

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

  useEffect(() => {
    if (!hasTauriRuntime()) return;

    let cancelled = false;
    getVersion()
      .then((version) => {
        if (!cancelled) setAppVersion(version);
      })
      .catch((err) => {
        console.error("getVersion failed", err);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  async function saveApiKey() {
    const apiKey = apiKeyInput.trim();
    if (!apiKey || savingApiKey) return;

    setSavingApiKey(true);
    setSettingsMessage(null);
    try {
      const next = await invoke<CairnSettingsStatus>("set_anthropic_api_key", {
        apiKey,
      });
      setSettingsStatus(next);
      setApiKeyInput("");
    } catch (err) {
      console.error("set_anthropic_api_key failed", err);
      setSettingsMessage("Could not save API key.");
    } finally {
      setSavingApiKey(false);
    }
  }

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
    settingsStatus,
    apiKeyInput,
    settingsMessage,
    savingApiKey,
    mcpStatus,
    mcpMessage,
    updatingMcpServer,
    appVersion,
    settingsPanelOpen,
    setApiKeyInput,
    setMcpMessage,
    openSettingsPanel,
    closeSettingsPanel,
    saveApiKey,
    setMcpServerEnabled,
    requestMcpAuth,
  };
}
