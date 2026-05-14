export type PanelTab = {
  key: string;
  label: string;
  available: boolean;
};

type PanelTabsProps = {
  tabs: PanelTab[];
  activeKey: string;
  onSelect: (key: string) => void;
};

const panelTabsClass =
  "panel-tabs flex items-center gap-3 px-7 pb-[22px] pt-[26px] max-[640px]:px-5 max-[640px]:pb-[18px] max-[640px]:pt-[22px]";

const tabClass =
  "tab inline-flex min-h-10 min-w-10 cursor-pointer items-center rounded-full border-0 bg-transparent px-3.5 py-0 font-[inherit] text-[0.95rem] font-semibold tracking-[-0.01em] text-muted-foreground transition-[background-color,box-shadow,color,opacity,transform] duration-[180ms,180ms,180ms,180ms,120ms] ease-[ease,ease,ease,ease,cubic-bezier(0.2,0,0,1)] hover:not-disabled:bg-[color-mix(in_srgb,var(--muted)_56%,transparent)] hover:not-disabled:text-foreground focus-visible:bg-[color-mix(in_srgb,var(--muted)_56%,transparent)] focus-visible:text-foreground focus-visible:shadow-[0_0_0_4px_color-mix(in_srgb,var(--primary)_20%,transparent)] focus-visible:outline-none active:not-disabled:scale-[0.96] disabled:cursor-not-allowed disabled:opacity-[0.38]";

const activeTabClass =
  "tab-active bg-[color-mix(in_srgb,var(--muted)_92%,transparent)] text-foreground shadow-sm";

export function PanelTabs({ tabs, activeKey, onSelect }: PanelTabsProps) {
  return (
    <div className={panelTabsClass} role="tablist" aria-label="Project panel">
      {tabs.map((tab) => {
        const isActive = tab.key === activeKey;

        return (
          <button
            key={tab.key}
            type="button"
            role="tab"
            aria-selected={isActive}
            className={`${tabClass}${isActive ? ` ${activeTabClass}` : ""}`}
            disabled={!tab.available}
            onClick={() => onSelect(tab.key)}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}
