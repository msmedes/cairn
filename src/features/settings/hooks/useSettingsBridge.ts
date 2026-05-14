import { useCallback } from "react";
import type { McpServerKey } from "../components/SettingsPanel";
import { useAppVersion } from "./internal/useAppVersion";
import { useCairnSettings } from "./internal/useCairnSettings";
import { useMcpSettings } from "./internal/useMcpSettings";
import { useSettingsPanel } from "./internal/useSettingsPanel";
import { useThemePreference } from "./internal/useThemePreference";

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
  const apiKey = useCairnSettings({ onApiKeyMissing: panel.open });
  const theme = useThemePreference({
    settingsStatus: apiKey.settingsStatus,
    onStatusUpdated: apiKey.setSettingsStatus,
  });
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
    themePreference: theme.themePreference,
    savingTheme: theme.savingTheme,
    appVersion,
    settingsPanelOpen: panel.isOpen,
    setApiKeyInput: apiKey.setApiKeyInput,
    setMcpMessage: mcp.setMcpMessage,
    openSettingsPanel,
    closeSettingsPanel: panel.close,
    saveApiKey: apiKey.saveApiKey,
    saveThemePreference: theme.saveThemePreference,
    setMcpServerEnabled: mcp.setMcpServerEnabled,
    requestMcpAuth: mcp.requestMcpAuth,
  };
}
