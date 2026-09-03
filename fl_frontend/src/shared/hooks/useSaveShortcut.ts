"use client";

import { useEffect, useRef } from "react";

import type { RefObject } from "react";

/**
 * `canSubmit` is the Speichern button's own gate and never a looser one; the argument is at
 * `fl_frontend/src/shared/components/ui/FormActionBar.tsx`.
 */
export function useSaveShortcut(formRef: RefObject<HTMLFormElement | null>, canSubmit: boolean) {
  const canSubmitRef = useRef(canSubmit);

  useEffect(() => {
    canSubmitRef.current = canSubmit;
  });

  useEffect(() => {
    const handleSaveShortcut = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
        // Unconditional, above the gate: moved inside it, a clean form would let the browser's save-page dialog open.
        event.preventDefault();
        if (canSubmitRef.current) formRef.current?.requestSubmit();
      }
    };

    window.addEventListener("keydown", handleSaveShortcut);
    return () => window.removeEventListener("keydown", handleSaveShortcut);
  }, [formRef]);
}
