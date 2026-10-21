"use client";

import { useRouter } from "next/navigation";

import CircleCheck from "@gravity-ui/icons/CircleCheck";

import { genehmigeAntragAction } from "@/features/berechtigungen/actions";
import { ANTRAG_ENTSCHEIDEN_VERWEHRT, ANTRAG_VERFALLEN, EIGENER_ANTRAG } from "@/features/berechtigungen/constants";
import { ConfirmActionRow } from "@/shared/components/ui/ConfirmActionRow";
import { ConfirmPressButton } from "@/shared/components/ui/ConfirmPressButton";
import { ConfirmReveal } from "@/shared/components/ui/ConfirmReveal";
import { FocusSlot } from "@/shared/components/ui/FocusSlot";
import { useTwoPressConfirm } from "@/shared/hooks/useTwoPressConfirm";
import { rejectedWrite } from "@/shared/utils/actionError";
import { appToast } from "@/shared/utils/appToast";
import { benannt } from "@/shared/utils/benannt";
import { focusAfterWrite } from "@/shared/utils/focusAfterWrite";

import type { FLBerechtigungAntragZeile } from "@/features/berechtigungen/schemas";

const ANTRAG_GENEHMIGEN = "Antrag genehmigen";

/** Why the approval is closed to this reader, in the words the backend's refusal of it is mapped to; `null` where it is open. */
function genehmigenGrund({ verwehrt, steht }: FLBerechtigungAntragZeile): string | null {
  if (verwehrt === "gestartet") return EIGENER_ANTRAG;
  if (verwehrt !== null) return ANTRAG_ENTSCHEIDEN_VERWEHRT[verwehrt];

  return steht ? null : ANTRAG_VERFALLEN;
}

/** What the approval hands over, said before the second press: the approver is the second pair of eyes a pretext has to get past. */
const FOLGE = {
  administration:
    "Mit Deiner Genehmigung erhält diese Adresse Zugang zur Verwaltung. Genehmige nur, wenn Du sicher bist, dass die Person ihn bekommen soll. Alle mit Zugang erhalten eine E-Mail.",
  owner:
    "Mit Deiner Genehmigung wird diese Adresse Inhaberin oder Inhaber der Verwaltung und kann dann Zugänge entziehen und jede Stufe ändern, auch Deine. Alle mit Zugang erhalten eine E-Mail.",
} as const;

/** A request's approval, the second pair of eyes a grant or a promotion waits on, closed with the backend's reason where this reader may not give it. */
export function AdminBerechtigungAntragGenehmigenPanel({
  antrag,
  zeile,
}: {
  antrag: FLBerechtigungAntragZeile;
  /** What tells the row apart in the control's name: the address, or the request's moment where it is withheld. */
  zeile: string;
}) {
  // The enrolment's window, as the action's: the prompt asks before a press the server would refuse.
  const twoPress = useTwoPressConfirm({ stepUp: "enrolment" });
  const router = useRouter();
  const { isConfirming, press } = twoPress;

  const handleGenehmigen = () => {
    // The request's row leaves the list once approved, so the focus moves to the next one's (`docs/frontend/spec.md :: I536`).
    const landing = focusAfterWrite();
    press(async () => {
      // A rejected action may still have saved, and uncaught here it takes the page down with it.
      const res = await genehmigeAntragAction({ id: antrag.id }).catch(rejectedWrite(router));

      if (!res.success) {
        appToast.failure("Nicht genehmigt", res);
        return;
      }

      landing.landed();
      appToast.success("Antrag genehmigt", { description: res.message });
    });
  };

  return (
    <div className="flex w-full flex-col gap-3">
      {isConfirming && (
        <ConfirmReveal>
          <p className="fluid-xxs leading-normal font-medium text-foreground">{FOLGE[antrag.verwaltung]}</p>
        </ConfirmReveal>
      )}

      <ConfirmActionRow confirm={twoPress}>
        <FocusSlot name="genehmigen">
          <ConfirmPressButton
            confirm={twoPress}
            reason={genehmigenGrund(antrag)}
            resting={ANTRAG_GENEHMIGEN}
            restingName={benannt(ANTRAG_GENEHMIGEN, zeile)}
            armed="Ja, Antrag genehmigen"
            running="Genehmigt..."
            icon={
              <CircleCheck
                className="size-4.5"
                aria-hidden="true"
              />
            }
            onPress={handleGenehmigen}
          />
        </FocusSlot>
      </ConfirmActionRow>
    </div>
  );
}
