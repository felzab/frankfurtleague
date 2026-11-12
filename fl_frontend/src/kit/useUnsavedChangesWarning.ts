"use client";

import { useEffect } from "react";

/**
 * The browser's own question before a reload or a closed tab, while something unsaved stands. It covers a real unload
 * alone: `beforeunload` never fires for a client-side navigation, which `LeaveGuard` holds where a page asks it to.
 */
export function useUnsavedChangesWarning(isDirty: boolean) {
  useEffect(() => {
    if (!isDirty) return undefined;
    const ask = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", ask);
    return () => window.removeEventListener("beforeunload", ask);
  }, [isDirty]);
}
