import { getVersion } from "@tauri-apps/api/app";
import { useEffect, useState } from "react";
import { hasTauriRuntime } from "../../../../lib/tauri";

export function useAppVersion() {
  const [appVersion, setAppVersion] = useState("unknown");

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

  return appVersion;
}
