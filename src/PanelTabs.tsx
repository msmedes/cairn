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
  "tab inline-flex min-h-10 min-w-10 cursor-pointer items-center rounded-full border-0 bg-transparent px-3.5 py-0 font-[inherit] text-[0.95rem] font-semibold tracking-[-0.01em] text-kanagawa-text-soft transition-[background-color,box-shadow,color,opacity,transform] duration-[180ms,180ms,180ms,180ms,120ms] ease-[ease,ease,ease,ease,cubic-bezier(0.2,0,0,1)] hover:not-disabled:bg-[rgba(42,42,55,0.56)] hover:not-disabled:text-kanagawa-text focus-visible:bg-[rgba(42,42,55,0.56)] focus-visible:text-kanagawa-text focus-visible:shadow-[0_0_0_4px_rgba(126,156,216,0.2)] focus-visible:outline-none active:not-disabled:scale-[0.96] disabled:cursor-not-allowed disabled:opacity-[0.38]";

const activeTabClass =
  "tab-active bg-[rgba(42,42,55,0.92)] text-kanagawa-text shadow-kanagawa-sm";

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
