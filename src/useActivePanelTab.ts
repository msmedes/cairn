import { useEffect, useRef, useState } from "react";

export type PanelTabKey = "project" | "plan" | "tasks";

export function useActivePanelTab(planExists: boolean, tasksExists = false) {
  const [activeTab, setActiveTab] = useState<PanelTabKey>("project");
  const previousPlanExistsRef = useRef(planExists);
  const previousTasksExistsRef = useRef(tasksExists);
  const hasAutoSwitchedPlanRef = useRef(false);
  const hasAutoSwitchedTasksRef = useRef(false);

  useEffect(() => {
    const previousPlanExists = previousPlanExistsRef.current;
    previousPlanExistsRef.current = planExists;

    if (hasAutoSwitchedPlanRef.current || previousPlanExists || !planExists) {
      return;
    }

    hasAutoSwitchedPlanRef.current = true;
    setActiveTab("plan");
  }, [planExists]);

  useEffect(() => {
    const previousTasksExists = previousTasksExistsRef.current;
    previousTasksExistsRef.current = tasksExists;

    if (
      hasAutoSwitchedTasksRef.current ||
      previousTasksExists ||
      !tasksExists
    ) {
      return;
    }

    hasAutoSwitchedTasksRef.current = true;
    setActiveTab("tasks");
  }, [tasksExists]);

  return { activeTab, setActiveTab };
}
