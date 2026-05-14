import { invoke } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";
import { hasTauriRuntime } from "../../../../lib/tauri";
import type {
  CairnSettingsStatus,
  ThemePreference,
} from "../../components/SettingsPanel";

type UseThemePreferenceArgs = {
  settingsStatus: CairnSettingsStatus | null;
  onStatusUpdated: (status: CairnSettingsStatus) => void;
};

export function useThemePreference({
  settingsStatus,
  onStatusUpdated,
}: UseThemePreferenceArgs) {
  const [savingTheme, setSavingTheme] = useState(false);
  const themePreference: ThemePreference =
    settingsStatus?.themePreference ?? "auto";

  useEffect(() => {
    if (typeof document === "undefined") return;
    const root = document.documentElement;
    if (themePreference === "auto") {
      root.removeAttribute("data-theme");
    } else {
      root.setAttribute("data-theme", themePreference);
    }
  }, [themePreference]);

  async function saveThemePreference(preference: ThemePreference) {
    if (!hasTauriRuntime()) return;
    if (savingTheme) return;
    if (preference === themePreference) return;

    setSavingTheme(true);
    try {
      const next = await invoke<CairnSettingsStatus>("set_theme_preference", {
        preference,
      });
      onStatusUpdated(next);
    } catch (err) {
      console.error("set_theme_preference failed", err);
    } finally {
      setSavingTheme(false);
    }
  }

  return {
    themePreference,
    savingTheme,
    saveThemePreference,
  };
}
