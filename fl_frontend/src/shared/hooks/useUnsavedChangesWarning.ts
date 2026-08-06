"use client";

/**
 * SHARED · the browser's own unsaved-changes prompt
 *
 * Covers a real page unload and nothing else. What it does not cover, and why nothing can, is on the
 * export — read that before assuming a form using this hook is fully guarded.
 */
import { useEffect, useRef } from "react";

/**
 * Asks the browser to confirm a real unload while there is unsaved work.
 *
 * **This covers exactly three things: a reload, a tab or window close, and a navigation typed into the
 * address bar or followed to another origin.** It does NOT cover client-side navigation, because
 * `beforeunload` never fires for it — a Next `<Link>`, `router.push` and `router.back` all change the
 * URL without unloading the document. A form that needs those guarded has to intercept them itself,
 * and one of them cannot be intercepted at all: **Next 16 exposes no navigation blocker.** Verified
 * against the `next/navigation` export surface and `AppRouterInstance`, which offers
 * `back/forward/push/replace/refresh/prefetch` and emits no events. `<Link onNavigate>` can cancel a
 * link press the page renders itself; the browser's Back button and any link rendered by a layout
 * above the page are out of reach.
 *
 * The message is the browser's. Chrome, Firefox and Safari have all ignored a custom string for years,
 * so `preventDefault()` is the whole API — and Chrome additionally requires prior interaction with the
 * page, which typing into a form satisfies.
 *
 * **`isDirty` is read through a ref, and that is not a style choice.** With it in the effect's
 * dependency array the listener is removed and re-added on every keystroke that flips the flag, which
 * is churn on the one event the browser dispatches while it is trying to close a tab. The ref is
 * refreshed by an unconditional effect — the same pattern `useServerFieldErrors` uses to hold a
 * caller's callback.
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
