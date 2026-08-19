"use client";

import { useEffect, useRef } from "react";

/**
 * Confirms a real unload and nothing else. **It does not cover client-side navigation** — `beforeunload` never fires for
 * it, and nothing else can either, the App Router exposing no navigation blocker.
 */
export function useUnsavedChangesWarning(isDirty: boolean) {
  const isDirtyRef = useRef(isDirty);

  useEffect(() => {
    isDirtyRef.current = isDirty;
  });

  useEffect(() => {
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!isDirtyRef.current) return;
      event.preventDefault();
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, []);
}
