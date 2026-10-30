"use client";

import { useRouter } from "next/navigation";

import Ban from "@gravity-ui/icons/Ban";
import TrashBin from "@gravity-ui/icons/TrashBin";

import { lehneAntragAbAction } from "@/features/berechtigungen/actions";
import { ANTRAG_ENTSCHEIDEN_VERWEHRT } from "@/features/berechtigungen/constants";
import { ConfirmActionRow } from "@/shared/components/ui/ConfirmActionRow";
import { ConfirmPressButton } from "@/shared/components/ui/ConfirmPressButton";
import { ConfirmReveal } from "@/shared/components/ui/ConfirmReveal";
import { FocusSlot } from "@/shared/components/ui/FocusSlot";
import { useTwoPressConfirm } from "@/shared/hooks/useTwoPressConfirm";
import { rejectedWrite } from "@/shared/utils/actionError";
import { appToast } from "@/shared/utils/appToast";
import { benannt } from "@/shared/utils/benannt";
import { focusAfterWrite } from "@/shared/utils/focusAfterWrite";

import type { FLBerechtigungAntragZeile } from "@/core/generated/client/types";

/** The refusal's words, and the withdrawal's on the requester's own request. */
const WORTE = {
  ablehnen: {
    resting: "Antrag ablehnen",
    armed: "Ja, Antrag ablehnen",
    running: "Lehnt ab...",
    erfolg: "Antrag abgelehnt",
    fehler: "Nicht abgelehnt",
  },
  zurueckziehen: {
    resting: "Antrag zurückziehen",
    armed: "Ja, Antrag zurückziehen",
    running: "Zieht zurück...",
    erfolg: "Antrag zurückgezogen",
    fehler: "Nicht zurückgezogen",
  },
} as const;

/**
 * A request's refusal by whoever may approve it, or its withdrawal by whoever made it, closed with the backend's reason
 * to anyone else. Two presses in the step-up's window, as the backend holds it: it hands nobody access.
 */
export function AdminBerechtigungAntragAblehnenPanel({
  antrag,
  zeile,
}: {
  antrag: FLBerechtigungAntragZeile;
  /** What tells the row apart in the control's name: the address, or the request's moment where it is withheld. */
  zeile: string;
}) {
  const { verwehrt } = antrag;
  // Its requester withdraws it whatever else holds; anyone else is judged as an approver is.
  const worte = verwehrt === "gestartet" ? WORTE.zurueckziehen : WORTE.ablehnen;
  const twoPress = useTwoPressConfirm({ stepUp: true });
  const router = useRouter();
  const { isConfirming, press } = twoPress;

  const handleAblehnen = () => {
    const landing = focusAfterWrite();
    press(async () => {
      // A rejected action may still have saved, and uncaught here it takes the page down with it.
      const res = await lehneAntragAbAction({ id: antrag.id }).catch(rejectedWrite(router));

      if (!res.success) {
        appToast.failure(worte.fehler, res);
        return;
      }

      landing.landed();
      appToast.success(worte.erfolg, { description: res.message });
    });
  };

  return (
    <div className="flex w-full flex-col gap-3">
      {isConfirming && (
        <ConfirmReveal>
          <p className="fluid-xxs leading-normal font-medium text-foreground">Der Antrag wird gelöscht, und am Zugang ändert sich nichts.</p>
        </ConfirmReveal>
      )}

      <ConfirmActionRow confirm={twoPress}>
        <FocusSlot name="ablehnen">
          <ConfirmPressButton
            confirm={twoPress}
            reason={verwehrt === null || verwehrt === "gestartet" ? null : ANTRAG_ENTSCHEIDEN_VERWEHRT[verwehrt]}
            resting={worte.resting}
            restingName={benannt(worte.resting, zeile)}
            armed={worte.armed}
            running={worte.running}
            icon={
              verwehrt === "gestartet" ? (
                <TrashBin
                  className="size-4.5"
                  aria-hidden="true"
                />
              ) : (
                <Ban
                  className="size-4.5"
                  aria-hidden="true"
                />
              )
            }
            onPress={handleAblehnen}
          />
        </FocusSlot>
      </ConfirmActionRow>
    </div>
  );
}
