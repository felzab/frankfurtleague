"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

import { appToast } from "@/shared/utils/appToast";

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
  const router = useRouter();

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

  // The toast fires before navigating: `Toast.Provider` sits above the router, and one queued after
  // `push()` races the caller's unmount.
  const signOutNow = async () => {
    try {
      const result = await onSignOut();

      if (result && !result.success) {
        appToast.danger("Nicht abgemeldet", { description: result.error });
        return;
      }

      // The fallback stands for `null`, which `FormState` admits and no sign-out sends: the catch
      // below is what answers a round trip that did not land.
      appToast.success(result?.message ?? "Abgemeldet");
      // `refresh()` drops the cached server render of the admin shell just left behind.
      router.push("/");
      router.refresh();
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
