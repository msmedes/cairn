import { useEffect, useRef, useState } from "react";
import { useModalOverlay } from "./useModalOverlay";

export type CairnSettingsStatus = {
  hasAnthropicApiKey: boolean;
};

export type McpSettingsStatus = {
  configPath: string;
  notionEnabled: boolean;
  notionManaged: boolean;
  notionSource?: string | null;
  slackEnabled: boolean;
  slackManaged: boolean;
  slackSource?: string | null;
};

export type McpServerKey = "notion" | "slack";

type SettingsPanelProps = {
  isOpen: boolean;
  onClose: () => void;
  settingsStatus: CairnSettingsStatus | null;
  apiKeyInput: string;
  settingsMessage: string | null;
  savingApiKey: boolean;
  mcpStatus: McpSettingsStatus | null;
  mcpMessage: string | null;
  updatingMcpServer: McpServerKey | null;
  onApiKeyInputChanged: (value: string) => void;
  onApiKeySaved: () => void;
  onMcpServerToggled: (server: McpServerKey, enabled: boolean) => void;
  onMcpAuthRequested: (server: McpServerKey) => void;
};

const MCP_SERVERS: Array<{
  key: McpServerKey;
  name: string;
  description: string;
}> = [
  {
    key: "notion",
    name: "Notion",
    description: "Pages, docs, databases",
  },
  {
    key: "slack",
    name: "Slack",
    description: "Channels, messages, canvases",
  },
];

function mcpServerEnabled(
  status: McpSettingsStatus | null,
  server: McpServerKey,
) {
  if (!status) return false;
  return server === "notion" ? status.notionEnabled : status.slackEnabled;
}

function mcpServerManaged(
  status: McpSettingsStatus | null,
  server: McpServerKey,
) {
  if (!status) return false;
  return server === "notion" ? status.notionManaged : status.slackManaged;
}

function mcpServerSource(
  status: McpSettingsStatus | null,
  server: McpServerKey,
) {
  if (!status) return null;
  return server === "notion" ? status.notionSource : status.slackSource;
}

export function SettingsPanel({
  isOpen,
  onClose,
  settingsStatus,
  apiKeyInput,
  settingsMessage,
  savingApiKey,
  mcpStatus,
  mcpMessage,
  updatingMcpServer,
  onApiKeyInputChanged,
  onApiKeySaved,
  onMcpServerToggled,
  onMcpAuthRequested,
}: SettingsPanelProps) {
  const hasKey = settingsStatus?.hasAnthropicApiKey ?? false;
  const [replacingKey, setReplacingKey] = useState(false);
  const previousSavingApiKeyRef = useRef(savingApiKey);
  const overlayRef = useModalOverlay<HTMLElement>(isOpen, closePanel);
  const showKeyForm = !hasKey || replacingKey;

  function closePanel() {
    setReplacingKey(false);
    if (hasKey) {
      onApiKeyInputChanged("");
    }
    onClose();
  }

  useEffect(() => {
    const wasSaving = previousSavingApiKeyRef.current;
    previousSavingApiKeyRef.current = savingApiKey;

    if (wasSaving && !savingApiKey && hasKey && apiKeyInput === "") {
      setReplacingKey(false);
    }
  }, [savingApiKey, hasKey, apiKeyInput]);

  if (!isOpen) return null;

  return (
    <section
      ref={overlayRef}
      className="settings-layer"
      role="dialog"
      aria-modal="true"
      aria-labelledby="settings-heading"
      tabIndex={-1}
    >
      <header className="settings-layer-header">
        <h2 id="settings-heading">Settings</h2>
        <button
          type="button"
          className="secondary-settings-button"
          onClick={closePanel}
        >
          Close
        </button>
      </header>

      <div className="settings-layer-body">
        <form
          className="settings-section"
          onSubmit={(event) => {
            event.preventDefault();
            onApiKeySaved();
          }}
        >
          <div className="settings-section-copy">
            <h3>Anthropic</h3>
            {!hasKey && <p>Add your Claude API key to start.</p>}
          </div>
          {showKeyForm ? (
            <div className="settings-row settings-row-form">
              <label htmlFor="anthropic-api-key">API key</label>
              <input
                id="anthropic-api-key"
                type="password"
                value={apiKeyInput}
                onChange={(event) =>
                  onApiKeyInputChanged(event.currentTarget.value)
                }
                placeholder="sk-ant-..."
                autoComplete="off"
                // biome-ignore lint/a11y/noAutofocus: Replace-key flow needs immediate focus on the input.
                autoFocus={replacingKey}
              />
              <button
                type="submit"
                disabled={!apiKeyInput.trim() || savingApiKey}
              >
                {savingApiKey ? "Saving..." : "Save"}
              </button>
              {hasKey && (
                <button
                  type="button"
                  className="secondary-settings-button"
                  onClick={() => {
                    setReplacingKey(false);
                    onApiKeyInputChanged("");
                  }}
                >
                  Cancel
                </button>
              )}
            </div>
          ) : (
            <div className="settings-saved-row">
              <span>Saved</span>
              <button
                type="button"
                className="secondary-settings-button"
                onClick={() => setReplacingKey(true)}
              >
                Replace
              </button>
            </div>
          )}
          {settingsMessage && (
            <p className="settings-inline-message">{settingsMessage}</p>
          )}
        </form>

        <section className="settings-section">
          <div className="settings-section-copy">
            <h3>MCP</h3>
            <p>{mcpStatus ? mcpStatus.configPath : "MCP config not loaded."}</p>
          </div>
          <div className="mcp-server-list">
            {MCP_SERVERS.map((server) => {
              const enabled = mcpServerEnabled(mcpStatus, server.key);
              const managed = mcpServerManaged(mcpStatus, server.key);
              const source = mcpServerSource(mcpStatus, server.key);
              const isUpdating = updatingMcpServer === server.key;
              const toggleDisabled = isUpdating || (enabled && !managed);

              return (
                <div className="mcp-server-row" key={server.key}>
                  <div>
                    <h4>{server.name}</h4>
                    <p>
                      {source && !managed
                        ? `${server.description} - configured in ${source}`
                        : server.description}
                    </p>
                  </div>
                  <div className="mcp-server-actions">
                    <button
                      type="button"
                      className="secondary-settings-button"
                      disabled={!enabled}
                      onClick={() => onMcpAuthRequested(server.key)}
                    >
                      Authenticate
                    </button>
                    <label className="settings-switch">
                      <span>
                        {enabled ? (managed ? "On" : "External") : "Off"}
                      </span>
                      <input
                        type="checkbox"
                        checked={enabled}
                        disabled={toggleDisabled}
                        onChange={(event) =>
                          onMcpServerToggled(
                            server.key,
                            event.currentTarget.checked,
                          )
                        }
                      />
                    </label>
                  </div>
                </div>
              );
            })}
          </div>
          {mcpMessage && (
            <p className="settings-inline-message">{mcpMessage}</p>
          )}
        </section>
      </div>
    </section>
  );
}
