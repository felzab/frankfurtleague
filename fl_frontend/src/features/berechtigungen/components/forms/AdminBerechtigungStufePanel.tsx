"use client";

import { useRouter } from "next/navigation";

import ChevronsDown from "@gravity-ui/icons/ChevronsDown";
import ChevronsUp from "@gravity-ui/icons/ChevronsUp";

import { patchBerechtigungAction } from "@/features/berechtigungen/actions";
import { INHABER_GESPERRT, stufeWorte } from "@/features/berechtigungen/constants";
import { ConfirmActionRow } from "@/shared/components/ui/ConfirmActionRow";
import { ConfirmPressButton } from "@/shared/components/ui/ConfirmPressButton";
import { ConfirmReveal } from "@/shared/components/ui/ConfirmReveal";
import { useTwoPressConfirm } from "@/shared/hooks/useTwoPressConfirm";
import { rejectedWrite } from "@/shared/utils/actionError";
import { appToast } from "@/shared/utils/appToast";
import { focusAfterWrite } from "@/shared/utils/focusAfterWrite";

import type { FLVerwaltung } from "@/features/berechtigungen/schemas";

/**
 * One grant's tier change, an owner's alone, escalated where the row stands as its revoke is: the armed
 * reveal names the person and the tier, since the passkey prompt's label replaces the armed one.
 */
export function AdminBerechtigungStufePanel({
  berechtigungId,
  adresse,
  erteiltAm,
  verwaltung,
  eigene,
}: {
  berechtigungId: string;
  /** `null` where the address is withheld, the grant's day then naming the row. */
  adresse: string | null;
  erteiltAm: string;
  verwaltung: FLVerwaltung;
  /** The signed-in owner's own grant, which this control steps down. */
  eigene: boolean;
}) {
  const ziel: FLVerwaltung = verwaltung === "owner" ? "administration" : "owner";
  const { resting, name, armed, running, folge } = stufeWorte({ adresse, erteiltAm, ziel, eigene });
  // The enrolment's window, as the action's: the prompt asks before a press the server would refuse.
  const twoPress = useTwoPressConfirm({ stepUp: "enrolment" });
  const router = useRouter();
  const { isConfirming, press } = twoPress;

  const handleAendern = () => {
    // An owner stepping down takes every tier control off the page with it, the pressed one included.
    const landing = focusAfterWrite();
    press(async () => {
      // A rejected action may still have saved, and uncaught here it takes the page down with it.
      const res = await patchBerechtigungAction({ id: berechtigungId, verwaltung: ziel }).catch(rejectedWrite(router));

      if (!res.success) {
        appToast.failure("Stufe nicht geändert", res);
        return;
      }

      landing.landed();
      appToast.success("Stufe geändert", { description: res.message });
    });
  };

  return (
    <div className="flex w-full flex-col gap-3">
      {isConfirming && (
        <ConfirmReveal>
          <p className="fluid-xxs leading-normal font-medium text-foreground">{folge}</p>
        </ConfirmReveal>
      )}

      <ConfirmActionRow confirm={twoPress}>
        {/* Named by its row and its tier, so each control in the list is one a screen reader can tell from the next. */}
        <ConfirmPressButton
          confirm={twoPress}
          // A barred address is made an owner by no request; its demotion stays open.
          reason={ziel === "owner" && adresse === null ? INHABER_GESPERRT : null}
          resting={resting}
          restingName={name}
          armed={armed}
          running={running}
          icon={
            ziel === "owner" ? (
              <ChevronsUp
                className="size-4.5"
                aria-hidden="true"
              />
            ) : (
              <ChevronsDown
                className="size-4.5"
                aria-hidden="true"
              />
            )
          }
          onPress={handleAendern}
        />
      </ConfirmActionRow>
    </div>
  );
}
