import { useEffect, useRef } from "react";

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

function focusableElements(root: HTMLElement) {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
}

function focusFirstElement(root: HTMLElement) {
  const [first] = focusableElements(root);
  (first ?? root).focus();
}

function trapTabKey(root: HTMLElement, event: KeyboardEvent) {
  const elements = focusableElements(root);
  if (elements.length === 0) {
    event.preventDefault();
    root.focus();
    return;
  }

  const first = elements[0];
  const last = elements[elements.length - 1];
  const active = document.activeElement;

  if (event.shiftKey && active === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && active === last) {
    event.preventDefault();
    first.focus();
  }
}

export function useModalOverlay<T extends HTMLElement>(
  isOpen: boolean,
  onClose: () => void,
) {
  const overlayRef = useRef<T>(null);
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!isOpen) return;

    const root = overlayRef.current;
    if (!root) return;
    const overlay = root;

    const previouslyFocused =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const siblingState = Array.from(overlay.parentElement?.children ?? [])
      .filter((element) => element !== overlay)
      .map((element) => ({
        element,
        inert: element.hasAttribute("inert"),
        ariaHidden: element.getAttribute("aria-hidden"),
      }));

    for (const { element } of siblingState) {
      element.setAttribute("inert", "");
      element.setAttribute("aria-hidden", "true");
    }

    const frame = window.requestAnimationFrame(() => {
      if (
        document.activeElement instanceof HTMLElement &&
        overlay.contains(document.activeElement)
      ) {
        return;
      }
      focusFirstElement(overlay);
    });

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onCloseRef.current();
        return;
      }

      if (event.key === "Tab") {
        trapTabKey(overlay, event);
      }
    }

    document.addEventListener("keydown", handleKeyDown, true);

    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener("keydown", handleKeyDown, true);

      for (const { element, inert, ariaHidden } of siblingState) {
        if (!inert) {
          element.removeAttribute("inert");
        }
        if (ariaHidden === null) {
          element.removeAttribute("aria-hidden");
        } else {
          element.setAttribute("aria-hidden", ariaHidden);
        }
      }

      if (previouslyFocused && document.contains(previouslyFocused)) {
        previouslyFocused.focus();
      }
    };
  }, [isOpen]);

  return overlayRef;
}
