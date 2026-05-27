import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { useEffect, useState } from "react";

export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

export type SidecarDevLogEntry = {
  id: string;
  receivedAt: string;
  payload: JsonValue;
};

const MAX_DEV_LOG_ENTRIES = 500;

function hasTauriRuntime() {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

function isObject(value: JsonValue | undefined): value is {
  [key: string]: JsonValue;
} {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function stringValue(value: JsonValue | undefined) {
  return typeof value === "string" ? value : null;
}

function numberValue(value: JsonValue | undefined) {
  return typeof value === "number" ? value : null;
}

function newId() {
  return Math.random().toString(36).slice(2);
}

function timestampFromPayload(payload: JsonValue) {
  if (!isObject(payload) || payload.type !== "session_event") return null;
  if (!isObject(payload.event)) return null;

  const eventTimestamp = stringValue(payload.event.timestamp);
  if (eventTimestamp) return eventTimestamp;

  if (!isObject(payload.event.message)) return null;
  const messageTimestamp = numberValue(payload.event.message.timestamp);
  return messageTimestamp ? new Date(messageTimestamp).toISOString() : null;
}

export function createSidecarDevLogEntry(
  payload: JsonValue,
): SidecarDevLogEntry {
  return {
    id: newId(),
    receivedAt: timestampFromPayload(payload) ?? new Date().toISOString(),
    payload,
  };
}

export function useSidecarDevLog() {
  const [events, setEvents] = useState<SidecarDevLogEntry[]>([]);

  useEffect(() => {
    if (!import.meta.env.DEV || !hasTauriRuntime()) return;

    let cancelled = false;
    let unlisten: UnlistenFn | undefined;

    listen<JsonValue>("sidecar-dev-log", (event) => {
      setEvents((prev) =>
        [...prev, createSidecarDevLogEntry(event.payload)].slice(
          -MAX_DEV_LOG_ENTRIES,
        ),
      );
    })
      .then((fn) => {
        if (cancelled) {
          fn();
          return;
        }
        unlisten = fn;
        invoke<JsonValue[]>("get_sidecar_dev_logs")
          .then((snapshot) => {
            if (cancelled || snapshot.length === 0) return;
            setEvents((prev) =>
              [...snapshot.map(createSidecarDevLogEntry), ...prev].slice(
                -MAX_DEV_LOG_ENTRIES,
              ),
            );
          })
          .catch((err) => {
            console.error("get_sidecar_dev_logs failed", err);
          });
      })
      .catch((err) => {
        console.error("sidecar-dev-log listen() failed", err);
      });

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);

  return {
    events,
    clearEvents: () => setEvents([]),
  };
}
