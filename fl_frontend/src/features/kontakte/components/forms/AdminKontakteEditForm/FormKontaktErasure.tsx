"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import TrashBin from "@gravity-ui/icons/TrashBin";

import { eraseKontaktpersonAction, readKontaktErasureAnsichtAction } from "@/features/kontakte/actions";
import { settledErasureAnsicht } from "@/features/kontakte/utils";
import { ConfirmActionRow } from "@/shared/components/ui/ConfirmActionRow";
import { ConfirmPressButton } from "@/shared/components/ui/ConfirmPressButton";
import { ConfirmReveal } from "@/shared/components/ui/ConfirmReveal";
import { FORM_SECTION_HEADING_CLASSES } from "@/shared/components/ui/formFieldStyles";
import { skeletonBlock } from "@/shared/components/ui/skeleton";
import { useTwoPressConfirm } from "@/shared/hooks/useTwoPressConfirm";
import { rejectedWrite } from "@/shared/utils/actionError";
import { appToast } from "@/shared/utils/appToast";
import { guardAgainstDraft } from "@/shared/utils/draftGuard";

import { DRAFT_IN_THE_WAY } from "./banners";
import { FormKontaktReveal } from "./FormKontaktReveal";

import type { ErasureAnsicht } from "@/features/kontakte/types";

/** A refused read, said once for the reveal's body and the closed press alike, so the two cannot part. */
const ohneUebersicht = (reason: string): string =>
  `Die Übersicht, wer dabei gelöscht wird, konnte nicht geladen werden, und ohne sie wird nichts gelöscht. ${reason}`;

/** The armed reveal's body, in the three states the read leaves it in. */
function ErasureAnsichtBody({ ansicht }: { ansicht: ErasureAnsicht | null }) {
  if (ansicht?.status === "read") {
    return (
      <FormKontaktReveal
        saison_teams={ansicht.sitze.saison_teams}
        bewerbungen={ansicht.sitze.bewerbungen}
      />
    );
  }

  if (ansicht?.status === "refused") {
    return <p className="fluid-xxs text-foreground leading-normal font-medium">{ohneUebersicht(ansicht.reason)}</p>;
  }

  // The app's one „not yet here“ treatment rather than a sentence the names then replace: what
  // arrives is a list, so what stands in for it is shaped like one.
  return (
    <div
      aria-hidden="true"
      className="flex w-full flex-col gap-y-2">
      <span className={`${skeletonBlock()} h-3 w-40 rounded-md`} />
      <span className={`${skeletonBlock()} h-4 w-full rounded-md`} />
      <span className={`${skeletonBlock()} h-4 w-full rounded-md`} />
    </div>
  );
}

/**
 * One contact person's erasure, from inside their own panel.
 *
 * **Keyed on the ADDRESS, not on this row**: it clears every seat that address holds, in every season
 * and both collections. Confirmed in place, so the reader sees whose data it is.
 */
export function FormKontaktErasure({ email, fullName, isDirty }: { email: string; fullName: string; isDirty: boolean }) {
  const twoPress = useTwoPressConfirm();
  const router = useRouter();
  const { isConfirming, isPending, press } = twoPress;
  const [gelesen, setGelesen] = useState<ErasureAnsicht | null>(null);

  const ansicht = gelesen?.email === email ? gelesen : null;

  const readAnsicht = async () => {
    setGelesen({ email, status: "reading" });

    // Settled, never awaited bare: outside a transition a rejected action (no connection, an answer
    // from something standing in front of this application) leaves the placeholder up and the write
    // closed beneath it for good.
    const [settled] = await Promise.allSettled([readKontaktErasureAnsichtAction({ email })]);

    setGelesen(settledErasureAnsicht(email, settled));
  };

  const handleErase = () => {
    if (!guardAgainstDraft(isDirty, DRAFT_IN_THE_WAY)) return;

    // On the arming press and on no other: this read serves contact records, so it is made when
    // somebody asks whom the address holds rather than on every render of the panel.
    if (!isConfirming) void readAnsicht();

    press(async () => {
      // A rejected action may still have saved, and uncaught here it takes the page down with it.
      const res = await eraseKontaktpersonAction({ email }).catch(rejectedWrite(router));

      if (!res.success) {
        appToast.failure("Kontaktperson nicht gelöscht", res);
        return;
      }

      /* The endpoint refuses nothing, so an address matching nobody succeeds and clears zero, and
         reporting that as „gelöscht“ would be a lie of the quiet kind. */
      if (res.cleared === 0) appToast.warning("Nichts gefunden", { description: res.message });
      else appToast.success("Kontaktperson gelöscht", { description: res.message });
    });
  };

  /* The object stays in the label: a bare „Ja, endgültig löschen“ reads as whatever the page is
     about, and this one reaches every season rather than this seat. */
  const ARMED_LABEL = "Ja, Kontaktperson endgültig löschen";

  // A refused read alone names a reason: a read still running ends by itself, as the write does.
  const closedReason = !isPending && isConfirming && ansicht?.status === "refused" ? ohneUebersicht(ansicht.reason) : null;

  // The names ARE the confirmation, so a press taken over the placeholder would confirm nothing.
  const isReading = isConfirming && (ansicht === null || ansicht.status === "reading");

  // The seat's own sub-block rule, as the Kenntnisnahme block above it uses: one divider treatment per
  // depth. The destructive grading is the confirm reveal's and the button's, both recipes.
  return (
    <div className="border-border/60 flex w-full flex-col gap-y-4 border-t pt-4">
      <h4 className={FORM_SECTION_HEADING_CLASSES}>Kontaktperson löschen</h4>

      <p className="muted-hint">
        Löscht <strong>{fullName}</strong> überall, nicht nur hier. Für eine Person, die vergessen werden möchte.
      </p>

      {isConfirming && (
        <ConfirmReveal>
          <ErasureAnsichtBody ansicht={ansicht} />
        </ConfirmReveal>
      )}

      <ConfirmActionRow confirm={twoPress}>
        <ConfirmPressButton
          confirm={twoPress}
          // The arming read holds the press without being the write: the press left the keyboard's
          // focus here, and the control says „Löscht...“ for the deletion alone.
          held={isReading}
          reason={closedReason}
          resting="Kontaktperson löschen"
          armed={ARMED_LABEL}
          running="Löscht..."

          icon={
            <TrashBin
              className="size-4.5"
              aria-hidden="true"
            />
          }
          onPress={handleErase}
        />
      </ConfirmActionRow>
    </div>
  );
}
