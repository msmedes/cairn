import { useEffect, useRef, useState } from "react";

export type PanelTabKey = "project" | "plan";

export function useActivePanelTab(planExists: boolean) {
  const [activeTab, setActiveTab] = useState<PanelTabKey>("project");
  const previousPlanExistsRef = useRef(planExists);
  const hasAutoSwitchedRef = useRef(false);

  useEffect(() => {
    const previousPlanExists = previousPlanExistsRef.current;
    previousPlanExistsRef.current = planExists;

    if (hasAutoSwitchedRef.current || previousPlanExists || !planExists) {
      return;
    }

    hasAutoSwitchedRef.current = true;
    setActiveTab("plan");
  }, [planExists]);

  return { activeTab, setActiveTab };
}
