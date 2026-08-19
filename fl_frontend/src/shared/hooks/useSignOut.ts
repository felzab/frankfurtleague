"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { appToast } from "@/shared/utils/appToast";

import type { FormState } from "@/shared/types/types";

/**
 * The sign-out's behaviour without its appearance: two surfaces offer it and look nothing alike, but what pressing either
 * does must not differ. `disarm` is each surface's own escape, that gesture differing where the reset does not.
 */
export function useSignOut(onSignOut: () => Promise<FormState>) {
  const [isSigningOut, startSignOut] = useTransition();
  const [isConfirming, setIsConfirming] = useState(false);
  const router = useRouter();

  // On iOS a tap on non-interactive content moves focus nowhere, so a capture-phase outside press is the
  // reliable disarm — `pointerdown` and `touchstart` both, since a scroll cancels the latter.
  useEffect(() => {
    if (!isConfirming) return;

    const handleOutsidePress = (event: Event) => {
      if (event.target instanceof Element && event.target.closest('[data-signout-control="true"]')) return;
      setIsConfirming(false);
    };

    document.addEventListener("pointerdown", handleOutsidePress, true);
    document.addEventListener("touchstart", handleOutsidePress, true);
    return () => {
      document.removeEventListener("pointerdown", handleOutsidePress, true);
      document.removeEventListener("touchstart", handleOutsidePress, true);
    };
  }, [isConfirming]);

  // The toast fires before navigating: `Toast.Provider` sits above the router, and one queued after
  // `push()` races the caller's unmount.
  const signOutNow = () => {
    startSignOut(async () => {
      try {
        const result = await onSignOut();

        if (result && !result.success) {
          appToast.danger("Abmelden fehlgeschlagen", { description: result.error ?? "Versuche es erneut." });
          return;
        }

        appToast.success(result?.message ?? "Erfolgreich abgemeldet");
        // `refresh()` drops the cached server render of the admin shell just left behind.
        router.push("/");
        router.refresh();
      } catch {
        appToast.danger("Abmelden fehlgeschlagen", { description: "Versuche es erneut." });
      }
    });
  };

  return {
    isConfirming,
    isSigningOut,
    /** One press: arms the control the first time, ends the session the second. */
    press: () => (isConfirming ? signOutNow() : setIsConfirming(true)),
    /** Back to rest. Called from whatever "never mind" looks like on the calling surface. */
    disarm: () => setIsConfirming(false),
  };
}
