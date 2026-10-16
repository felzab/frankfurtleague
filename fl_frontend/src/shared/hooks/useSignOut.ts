"use client";

import { useEffect } from "react";

import { appToast } from "@/shared/utils/appToast";
import { leaveDocumentFor } from "@/shared/utils/documentNavigation";

import { useTwoPressConfirm } from "./useTwoPressConfirm";

import type { FormState } from "@/shared/types/types";

/**
 * The sign-out's behaviour without its appearance: two surfaces offer it and look nothing alike, but what pressing either
 * does must not differ. `disarm` is each surface's own escape, that gesture differing where the reset does not.
 */
export function useSignOut(onSignOut: () => Promise<FormState>) {
  // The panels' own two-press control, whose double-press window keeps a double-click from ending the
  // session before the armed control was read (`docs/frontend/spec.md :: I37`).
  const confirm = useTwoPressConfirm();
  const { isConfirming, press, cancel } = confirm;

  // On iOS a tap on non-interactive content moves focus nowhere, so a capture-phase outside press is the
  // reliable disarm — `pointerdown` and `touchstart` both, since a scroll cancels the latter.
  useEffect(() => {
    if (!isConfirming) return;

    const handleOutsidePress = (event: Event) => {
      if (event.target instanceof Element && event.target.closest('[data-signout-control="true"]')) return;
      cancel();
    };

    document.addEventListener("pointerdown", handleOutsidePress, true);
    document.addEventListener("touchstart", handleOutsidePress, true);
    return () => {
      document.removeEventListener("pointerdown", handleOutsidePress, true);
      document.removeEventListener("touchstart", handleOutsidePress, true);
    };
  }, [isConfirming, cancel]);

  // A success raises no toast, as a sign-in raises none: the start page replaces this document before
  // one could be read.
  const signOutNow = async () => {
    try {
      const result = await onSignOut();

      if (result && !result.success) {
        appToast.danger("Nicht abgemeldet", { description: result.error });
        return;
      }

      // A full document load, as Next's guide advises for a sign-out: a soft navigation keeps every route
      // the router hid, with its rows and what was typed into it.
      leaveDocumentFor("/");
    } catch {
      // A cut request may have ended the session or not, so neither answer above is true of it.
      appToast.danger("Abmeldung unklar", { description: "Lade die Seite neu, um zu sehen, ob Du noch angemeldet bist." });
    }
  };

  return {
    /** The two-press value whole, which each surface reads its armed and running state off rather than spelling either. */
    confirm,
    /** One press: arms the control the first time, ends the session the second. */
    press: () => press(signOutNow),
    /** Back to rest. Called from whatever "never mind" looks like on the calling surface. */
    disarm: cancel,
  };
}
