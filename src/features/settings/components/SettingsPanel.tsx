import { useEffect, useRef, useState } from "react";
import { useModalOverlay } from "../../../hooks/useModalOverlay";

export type ThemePreference = "auto" | "light" | "dark";

export type CairnSettingsStatus = {
  hasAnthropicApiKey: boolean;
  themePreference: ThemePreference;
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
  themePreference: ThemePreference;
  savingTheme: boolean;
  onApiKeyInputChanged: (value: string) => void;
  onApiKeySaved: () => void;
  onThemePreferenceChanged: (preference: ThemePreference) => void;
  onMcpServerToggled: (server: McpServerKey, enabled: boolean) => void;
  onMcpAuthRequested: (server: McpServerKey) => void;
};

const THEME_OPTIONS: Array<{ value: ThemePreference; label: string }> = [
  { value: "auto", label: "Auto" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

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

const layerClass =
  "settings-layer fixed inset-0 z-20 grid text-foreground antialiased [--settings-pad-x:clamp(20px,4vw,48px)] [grid-template-rows:auto_minmax(0,1fr)] bg-[radial-gradient(circle_at_12%_-10%,color-mix(in_srgb,var(--primary)_var(--wash-primary),transparent),transparent_38%),radial-gradient(circle_at_92%_6%,color-mix(in_srgb,var(--warm)_var(--wash-warm),transparent),transparent_32%),linear-gradient(180deg,var(--card)_0%,var(--background)_100%)] [-moz-osx-font-smoothing:grayscale] animate-[dev-layer-in_220ms_cubic-bezier(0.2,0,0,1)_both]";

const headerClass =
  "settings-layer-header flex items-center justify-between gap-6 px-[var(--settings-pad-x)] pb-[18px] pt-[22px]";

const headingClass =
  "m-0 font-serif text-[1.72rem] font-semibold leading-[1.05] tracking-[-0.025em]";

const bodyClass =
  "settings-layer-body grid min-h-0 content-start overflow-auto px-[var(--settings-pad-x)] pb-8 pt-1";

const sectionClass = "settings-section grid gap-3.5 py-[22px]";

const sectionDividerClass = "border-t border-[var(--border)]";

const sectionCopyClass = "settings-section-copy grid gap-1";

const sectionTitleClass =
  "m-0 text-base leading-tight tracking-normal text-foreground";

const sectionTextClass =
  "m-0 [overflow-wrap:anywhere] text-sm leading-[1.45] text-muted-foreground";

const formRowClass =
  "settings-row settings-row-form grid items-center gap-2 [grid-template-columns:minmax(92px,auto)_minmax(0,1fr)_auto] max-[640px]:grid-cols-1";

const labelClass = "text-sm font-semibold text-secondary-foreground";

const inputClass =
  "min-h-10 min-w-0 rounded-md border-0 bg-input px-3 py-0 font-[inherit] text-foreground shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--foreground)_8%,transparent)] outline-none focus:shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--primary)_46%,transparent),0_0_0_4px_color-mix(in_srgb,var(--primary)_12%,transparent)]";

const primaryButtonClass =
  "min-h-10 cursor-pointer rounded-md border-0 bg-[linear-gradient(180deg,var(--primary),color-mix(in_oklab,var(--primary),black_18%))] px-3.5 py-0 font-[inherit] text-sm font-semibold text-background transition-[background-color,box-shadow,color,transform] duration-[180ms,180ms,180ms,120ms] ease-[ease,ease,ease,cubic-bezier(0.2,0,0,1)] focus-visible:shadow-[0_0_0_4px_color-mix(in_srgb,var(--primary)_18%,transparent)] focus-visible:outline-none active:not-disabled:scale-[0.96] disabled:cursor-not-allowed disabled:opacity-45";

const secondaryButtonClass =
  "secondary-settings-button min-h-10 cursor-pointer rounded-md border border-[var(--border-strong)] bg-transparent px-3.5 py-0 font-[inherit] text-sm font-semibold text-foreground transition-[background-color,border-color,box-shadow,transform] duration-[180ms,180ms,180ms,120ms] ease-[ease,ease,ease,cubic-bezier(0.2,0,0,1)] hover:not-disabled:bg-[color-mix(in_srgb,var(--foreground)_5%,transparent)] hover:not-disabled:border-[color-mix(in_srgb,var(--foreground)_22%,transparent)] focus-visible:bg-[color-mix(in_srgb,var(--foreground)_5%,transparent)] focus-visible:shadow-[0_0_0_3px_color-mix(in_srgb,var(--primary)_22%,transparent)] focus-visible:outline-none active:not-disabled:scale-[0.96] disabled:cursor-not-allowed disabled:opacity-45";

const savedRowClass =
  "settings-saved-row flex items-center justify-between gap-3.5 text-[0.95rem] text-secondary-foreground";

const mcpListClass = "mcp-server-list grid";

const mcpRowClass =
  "mcp-server-row grid items-center gap-3.5 border-t border-[var(--border)] py-3.5 first:border-t-0 [grid-template-columns:minmax(0,1fr)_auto] max-[640px]:grid-cols-1";

const mcpActionsClass =
  "mcp-server-actions inline-flex items-center justify-end gap-2.5 max-[640px]:justify-between";

const themeSegmentGroupClass =
  "inline-flex w-fit gap-0.5 rounded-md bg-input p-0.5 shadow-[inset_0_0_0_1px_var(--border)]";

const themeSegmentLabelClass =
  "relative inline-flex min-h-9 cursor-pointer items-center justify-center rounded-[5px] px-3.5 text-sm font-semibold text-muted-foreground transition-[background-color,color,box-shadow] duration-180 ease-in hover:text-foreground has-[:checked]:bg-[color-mix(in_srgb,var(--primary)_18%,transparent)] has-[:checked]:text-foreground has-[:checked]:shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--primary)_34%,transparent)] has-[:focus-visible]:shadow-[0_0_0_3px_color-mix(in_srgb,var(--primary)_22%,transparent)] has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-60";

const switchClass =
  "settings-switch inline-flex min-h-10 cursor-pointer items-center gap-2.5 text-[0.88rem] font-semibold text-secondary-foreground";

const switchInputClass =
  "m-0 h-[26px] w-[46px] cursor-pointer appearance-none rounded-full bg-[color-mix(in_srgb,var(--background)_90%,transparent)] shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--foreground)_10%,transparent),inset_0_2px_8px_rgb(0_0_0/0.2)] transition-[background-color,box-shadow] duration-180 ease-in before:m-[3px] before:block before:h-5 before:w-5 before:rounded-full before:bg-muted-foreground before:shadow-[0_2px_6px_rgb(0_0_0/0.24)] before:transition-[background-color,transform] before:duration-180 before:ease-[cubic-bezier(0.2,0,0,1)] before:content-[''] checked:bg-[color-mix(in_srgb,var(--primary)_38%,transparent)] checked:shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--primary)_42%,transparent),0_0_0_4px_color-mix(in_srgb,var(--primary)_8%,transparent)] checked:before:translate-x-5 checked:before:bg-foreground focus-visible:shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--primary)_50%,transparent),0_0_0_4px_color-mix(in_srgb,var(--primary)_16%,transparent)] focus-visible:outline-none";

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
  themePreference,
  savingTheme,
  onApiKeyInputChanged,
  onApiKeySaved,
  onThemePreferenceChanged,
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
      className={layerClass}
      role="dialog"
      aria-modal="true"
      aria-labelledby="settings-heading"
      tabIndex={-1}
    >
      <header className={headerClass}>
        <h2 className={headingClass} id="settings-heading">
          Settings
        </h2>
        <button
          type="button"
          className={secondaryButtonClass}
          onClick={closePanel}
        >
          Close
        </button>
      </header>

      <div className={bodyClass}>
        <form
          className={sectionClass}
          onSubmit={(event) => {
            event.preventDefault();
            onApiKeySaved();
          }}
        >
          <div className={sectionCopyClass}>
            <h3 className={sectionTitleClass}>Anthropic</h3>
            {!hasKey && (
              <p className={sectionTextClass}>
                Add your Claude API key to start.
              </p>
            )}
          </div>
          {showKeyForm ? (
            <div className={formRowClass}>
              <label className={labelClass} htmlFor="anthropic-api-key">
                API key
              </label>
              <input
                className={inputClass}
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
                className={primaryButtonClass}
                disabled={!apiKeyInput.trim() || savingApiKey}
              >
                {savingApiKey ? "Saving..." : "Save"}
              </button>
              {hasKey && (
                <button
                  type="button"
                  className={secondaryButtonClass}
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
            <div className={savedRowClass}>
              <span>Saved</span>
              <button
                type="button"
                className={secondaryButtonClass}
                onClick={() => setReplacingKey(true)}
              >
                Replace
              </button>
            </div>
          )}
          {settingsMessage && (
            <p className={sectionTextClass}>{settingsMessage}</p>
          )}
        </form>

        <section
          className={`${sectionClass} ${sectionDividerClass}`}
          aria-labelledby="settings-appearance-heading"
        >
          <div className={sectionCopyClass}>
            <h3 className={sectionTitleClass} id="settings-appearance-heading">
              Appearance
            </h3>
            <p className={sectionTextClass}>
              Auto follows your system preference.
            </p>
          </div>
          <div
            className={themeSegmentGroupClass}
            role="radiogroup"
            aria-label="Theme"
          >
            {THEME_OPTIONS.map((option) => (
              <label key={option.value} className={themeSegmentLabelClass}>
                <input
                  type="radio"
                  name="theme-preference"
                  value={option.value}
                  checked={themePreference === option.value}
                  disabled={savingTheme}
                  onChange={() => onThemePreferenceChanged(option.value)}
                  className="sr-only"
                />
                {option.label}
              </label>
            ))}
          </div>
        </section>

        <section className={`${sectionClass} ${sectionDividerClass}`}>
          <div className={sectionCopyClass}>
            <h3 className={sectionTitleClass}>MCP</h3>
            <p className={sectionTextClass}>
              {mcpStatus ? mcpStatus.configPath : "MCP config not loaded."}
            </p>
          </div>
          <div className={mcpListClass}>
            {MCP_SERVERS.map((server) => {
              const enabled = mcpServerEnabled(mcpStatus, server.key);
              const managed = mcpServerManaged(mcpStatus, server.key);
              const source = mcpServerSource(mcpStatus, server.key);
              const isUpdating = updatingMcpServer === server.key;
              const toggleDisabled = isUpdating || (enabled && !managed);

              return (
                <div className={mcpRowClass} key={server.key}>
                  <div>
                    <h4 className={sectionTitleClass}>{server.name}</h4>
                    <p className={sectionTextClass}>
                      {source && !managed
                        ? `${server.description} - configured in ${source}`
                        : server.description}
                    </p>
                  </div>
                  <div className={mcpActionsClass}>
                    <button
                      type="button"
                      className={secondaryButtonClass}
                      disabled={!enabled}
                      onClick={() => onMcpAuthRequested(server.key)}
                    >
                      Authenticate
                    </button>
                    <label className={switchClass}>
                      <span>
                        {enabled ? (managed ? "On" : "External") : "Off"}
                      </span>
                      <input
                        className={switchInputClass}
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
          {mcpMessage && <p className={sectionTextClass}>{mcpMessage}</p>}
        </section>
      </div>
    </section>
  );
}
