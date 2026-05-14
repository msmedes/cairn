import { invoke } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";
import { hasTauriRuntime } from "../../../../lib/tauri";
import type { CairnSettingsStatus } from "../../components/SettingsPanel";

type UseCairnSettingsArgs = {
  onApiKeyMissing: () => void;
};

export function useCairnSettings({ onApiKeyMissing }: UseCairnSettingsArgs) {
  const [settingsStatus, setSettingsStatus] =
    useState<CairnSettingsStatus | null>(null);
  const [apiKeyInput, setApiKeyInput] = useState("");
  const [settingsMessage, setSettingsMessage] = useState<string | null>(null);
  const [savingApiKey, setSavingApiKey] = useState(false);

  useEffect(() => {
    if (!hasTauriRuntime()) return;

    let cancelled = false;
    invoke<CairnSettingsStatus>("get_cairn_settings")
      .then((status) => {
        if (cancelled) return;
        setSettingsStatus(status);
        if (!status.hasAnthropicApiKey) {
          onApiKeyMissing();
        }
      })
      .catch((err) => {
        console.error("get_cairn_settings failed", err);
      });

    return () => {
      cancelled = true;
    };
  }, [onApiKeyMissing]);

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

  return {
    settingsStatus,
    apiKeyInput,
    settingsMessage,
    savingApiKey,
    setSettingsStatus,
    setApiKeyInput,
    setSettingsMessage,
    saveApiKey,
  };
}
