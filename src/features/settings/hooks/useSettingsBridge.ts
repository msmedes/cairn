import { useCallback } from "react";
import type { McpServerKey } from "../components/SettingsPanel";
import { useApiKeySettings } from "./internal/useApiKeySettings";
import { useAppVersion } from "./internal/useAppVersion";
import { useMcpSettings } from "./internal/useMcpSettings";
import { useSettingsPanel } from "./internal/useSettingsPanel";

type UseSettingsBridgeArgs = {
  activeProjectPath: string | null;
  authenticateMcpServer: (server: McpServerKey) => Promise<void>;
};

export function useSettingsBridge({
  activeProjectPath,
  authenticateMcpServer,
}: UseSettingsBridgeArgs) {
  const mcp = useMcpSettings({ activeProjectPath, authenticateMcpServer });
  const panel = useSettingsPanel();
  const apiKey = useApiKeySettings({ onApiKeyMissing: panel.open });
  const appVersion = useAppVersion();
  const openSettingsPanel = useCallback(() => {
    panel.open();
    apiKey.setSettingsMessage(null);
    mcp.setMcpMessage(null);
  }, [apiKey.setSettingsMessage, mcp.setMcpMessage, panel.open]);

  return {
    settingsStatus: apiKey.settingsStatus,
    apiKeyInput: apiKey.apiKeyInput,
    settingsMessage: apiKey.settingsMessage,
    savingApiKey: apiKey.savingApiKey,
    mcpStatus: mcp.mcpStatus,
    mcpMessage: mcp.mcpMessage,
    updatingMcpServer: mcp.updatingMcpServer,
    appVersion,
    settingsPanelOpen: panel.isOpen,
    setApiKeyInput: apiKey.setApiKeyInput,
    setMcpMessage: mcp.setMcpMessage,
    openSettingsPanel,
    closeSettingsPanel: panel.close,
    saveApiKey: apiKey.saveApiKey,
    setMcpServerEnabled: mcp.setMcpServerEnabled,
    requestMcpAuth: mcp.requestMcpAuth,
  };
}
