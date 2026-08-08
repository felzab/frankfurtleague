"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { appToast } from "@/shared/utils/appToast";

import type { FormState } from "@/shared/types/types";

/**
 * The sign-out's behaviour, without its appearance.
 *
 * **Two surfaces offer this control** — inline at the end of the shell's bar, and as a row in the
 * sidemenu footer's options menu (ADR-0058) — and they look nothing alike: one is a compact button on
 * a 54px bar, the other a full-width row in a 220px menu. What must NOT differ is what pressing
 * either one does, so the arming, the transition, the toast and the navigation live here and each
 * surface supplies only its own markup.
 *
 * **The two-press confirm is the whole point of the hook having state at all** (owner decision
 * 2026-07-31): the first press arms, the second signs out. `disarm` is what each surface wires to its
 * own escape — a blur, an Escape key, a menu closing — because the gesture that means "never mind"
 * differs between a bar button and a menu row, while the reset itself does not.
 */
export function useSignOut(onSignOut: () => Promise<FormState>) {
  const [isSigningOut, startSignOut] = useTransition();
  const [isConfirming, setIsConfirming] = useState(false);
  const router = useRouter();

  // The armed state must survive nothing but a second press on the control itself. `onBlur` covers
  // a keyboard user; on iOS a tap on non-interactive content moves focus NOWHERE, so the armed
  // button sat there until it was pressed again (owner, 2026-08-07). A capture-phase outside press
  // is the reliable disarm — `pointerdown` AND `touchstart`, because a touch that becomes a scroll
  // can end in `pointercancel` on some mobile engines while `touchstart` has already fired, and the
  // owner reported the armed control surviving exactly such taps. Double-firing is harmless: the
  // second call sets state that is already false.
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

  // The action returns rather than redirecting, so the navigation happens here — see the note on
  // `signOutAction`. The toast is fired BEFORE navigating: `Toast.Provider` is mounted once above the
  // router in `RootProviders`, so it survives the transition, whereas a toast queued after `push()`
  // races the caller's unmount and was simply never seen.
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
