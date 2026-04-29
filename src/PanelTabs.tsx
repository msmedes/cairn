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

export function PanelTabs({ tabs, activeKey, onSelect }: PanelTabsProps) {
  return (
    <div className="panel-tabs" role="tablist" aria-label="Project panel">
      {tabs.map((tab) => {
        const isActive = tab.key === activeKey;

        return (
          <button
            key={tab.key}
            type="button"
            role="tab"
            aria-selected={isActive}
            className={`tab${isActive ? " tab-active" : ""}`}
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
