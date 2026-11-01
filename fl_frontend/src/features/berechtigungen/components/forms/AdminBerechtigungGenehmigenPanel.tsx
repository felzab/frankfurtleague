"use client";

import { useRouter } from "next/navigation";

import CircleCheck from "@gravity-ui/icons/CircleCheck";

import { formatInstant } from "@/core/format";
import { genehmigeAdresswechselAction } from "@/features/adresswechsel/actions";
import { GENEHMIGUNG_VERWEHRT } from "@/features/adresswechsel/refusals";
import { nachVonOderGesperrt, vonOderGesperrt } from "@/features/berechtigungen/constants";
import { ConfirmActionRow } from "@/shared/components/ui/ConfirmActionRow";
import { ConfirmPressButton } from "@/shared/components/ui/ConfirmPressButton";
import { ConfirmReveal } from "@/shared/components/ui/ConfirmReveal";
import { FocusSlot } from "@/shared/components/ui/FocusSlot";
import { useTwoPressConfirm } from "@/shared/hooks/useTwoPressConfirm";
import { rejectedWrite } from "@/shared/utils/actionError";
import { appToast } from "@/shared/utils/appToast";
import { benannt } from "@/shared/utils/benannt";
import { focusAfterWrite } from "@/shared/utils/focusAfterWrite";

import type { FLGrantAddressChange } from "@/core/generated/client/types";

const AENDERUNG_GENEHMIGEN = "Adressänderung genehmigen";

/**
 * Who started the change and how, which is what a pretext hides: the starter is absent where the row withholds them
 * from a non-owner, the backend deciding that rather than this panel.
 */
function begonnen(adresswechsel: FLGrantAddressChange): string {
  if (adresswechsel.way === "account") return "Die Person hat die Änderung selbst in ihrem Konto angefragt.";

  const von =
    adresswechsel.started_by === null && !adresswechsel.started_by_barred
      ? "Aus der Verwaltung begonnen"
      : `Begonnen von ${nachVonOderGesperrt(adresswechsel.started_by, adresswechsel.started_by_barred)}`;
  const weg = adresswechsel.way === "release" ? "mit Freigabe durch die bisherige Adresse" : "ohne die bisherige Adresse";

  return `${von}, ${weg}.${adresswechsel.grund === null ? "" : ` Grund: ${adresswechsel.grund}`}`;
}

/** The new address, or why the row withholds it. */
function neueAdresse(adresswechsel: FLGrantAddressChange): string {
  if (adresswechsel.email !== null) return adresswechsel.email;

  return adresswechsel.email_barred ? vonOderGesperrt(null, true) : "nur für Inhaberinnen und Inhaber sichtbar";
}

/**
 * The approval of a grant holder's change, on the grant it moves: four eyes on the change that hands a grant to
 * another address. Two presses in the enrolment's window: what it hands over outlives the session giving it.
 */
export function AdminBerechtigungGenehmigenPanel({ adresse, adresswechsel }: { adresse: string | null; adresswechsel: FLGrantAddressChange }) {
  // The enrolment's window, as the action's: the prompt asks before a press the server would refuse.
  const twoPress = useTwoPressConfirm({ stepUp: "enrolment" });
  const router = useRouter();
  const { isConfirming, press } = twoPress;

  const handleGenehmigen = () => {
    const landing = focusAfterWrite();
    press(async () => {
      // A rejected action may still have saved, and uncaught here it takes the page down with it.
      const res = await genehmigeAdresswechselAction({ id: adresswechsel.id }, adresswechsel.viewable_denied).catch(rejectedWrite(router));

      if (!res.success) {
        appToast.failure("Nicht genehmigt", res);
        return;
      }

      landing.landed();
      appToast.success("Adressänderung genehmigt", { description: res.message });
    });
  };

  return (
    <div className="flex w-full flex-col gap-3">
      <p className="fluid-sm text-pretty text-foreground">
        Neue Adresse für diesen Zugang: {neueAdresse(adresswechsel)}.{" "}
        {adresswechsel.confirmed ? "Sie ist bestätigt." : "Sie ist noch nicht bestätigt."} Genehmigen bis {formatInstant(adresswechsel.bis)}.
      </p>
      <p className="fluid-sm text-pretty text-foreground">{begonnen(adresswechsel)}</p>

      {isConfirming && (
        <ConfirmReveal>
          {/* The approver is the second pair of eyes a pretext has to get past, so the press asks for the check it stands for. */}
          <p className="fluid-xxs leading-normal font-medium text-foreground">
            Mit Deiner Genehmigung wechselt der Zugang zur Verwaltung zur neuen Adresse
            {adresswechsel.confirmed ? ", sobald keine Wartezeit mehr läuft" : ", sobald sie bestätigt ist"}. Genehmige nur, wenn Du sicher
            bist, dass die Person die Änderung selbst angefragt hat.
          </p>
        </ConfirmReveal>
      )}

      <ConfirmActionRow confirm={twoPress}>
        <FocusSlot name="genehmigen">
          <ConfirmPressButton
            confirm={twoPress}
            reason={adresswechsel.denied === null ? null : GENEHMIGUNG_VERWEHRT[adresswechsel.denied]}
            resting={AENDERUNG_GENEHMIGEN}
            // Named by its row, so each control in the list is one a screen reader can tell from the next.
            restingName={benannt(AENDERUNG_GENEHMIGEN, adresse ?? neueAdresse(adresswechsel))}
            armed="Ja, Adressänderung genehmigen"
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
