import { useEffect, useRef } from "react";

export function useAutoScroll<T>(dependency: T) {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [dependency]);

  return ref;
}
