"use client";

import { useRouter } from "next/navigation";

import CircleCheck from "@gravity-ui/icons/CircleCheck";

import { adresswechselZeitpunkt } from "@/core/adresswechsel";
import { genehmigeAdresswechselAction } from "@/features/adresswechsel/actions";
import { GENEHMIGUNG_JUENGER } from "@/features/adresswechsel/refusals";
import { vonOderGesperrt } from "@/features/berechtigungen/constants";
import { ConfirmActionRow } from "@/shared/components/ui/ConfirmActionRow";
import { ConfirmPressButton } from "@/shared/components/ui/ConfirmPressButton";
import { ConfirmReveal } from "@/shared/components/ui/ConfirmReveal";
import { FocusSlot } from "@/shared/components/ui/FocusSlot";
import { useTwoPressConfirm } from "@/shared/hooks/useTwoPressConfirm";
import { rejectedWrite } from "@/shared/utils/actionError";
import { appToast } from "@/shared/utils/appToast";
import { focusAfterWrite } from "@/shared/utils/focusAfterWrite";

import type { FLBerechtigungAdresswechsel } from "@/features/berechtigungen/schemas";

export const AENDERUNG_GENEHMIGEN = "Adressänderung genehmigen";

/** Why this administrator may not give the approval, in the backend's own refusals' words. */
const VERWEHRT: Readonly<Record<NonNullable<FLBerechtigungAdresswechsel["verwehrt"]>, string>> = {
  eigene: "Eine Änderung Deiner eigenen Adresse genehmigt eine andere Person aus der Verwaltung.",
  gestartet: "Eine Änderung, die Du selbst begonnen hast, genehmigt eine andere Person aus der Verwaltung.",
  inhaber: "Die neue Adresse eines Zugangs als Inhaberin oder Inhaber genehmigt nur eine andere Inhaberin oder ein anderer Inhaber.",
  juenger: GENEHMIGUNG_JUENGER,
};

/**
 * Who started the change and how, which is what a pretext hides: the starter is absent where the row withholds them
 * from a non-owner, the backend deciding that rather than this panel.
 */
function begonnen(adresswechsel: FLBerechtigungAdresswechsel): string {
  if (adresswechsel.weg === "konto") return "Die Person hat die Änderung selbst in ihrem Konto angefragt.";

  const von =
    adresswechsel.gestartet_von === null && !adresswechsel.gestartet_von_gesperrt
      ? "Aus der Verwaltung begonnen"
      : `Begonnen von ${vonOderGesperrt(adresswechsel.gestartet_von, adresswechsel.gestartet_von_gesperrt)}`;
  const weg = adresswechsel.weg === "freigabe" ? "mit Freigabe durch die bisherige Adresse" : "ohne die bisherige Adresse";

  return `${von}, ${weg}.${adresswechsel.grund === null ? "" : ` Grund: ${adresswechsel.grund}`}`;
}

/** The new address, or why the row withholds it. */
function neueAdresse(adresswechsel: FLBerechtigungAdresswechsel): string {
  if (adresswechsel.email !== null) return adresswechsel.email;

  return adresswechsel.email_gesperrt ? vonOderGesperrt(null, true) : "nur für Inhaberinnen und Inhaber sichtbar";
}

/**
 * The approval of a grant holder's change, on the grant it moves: four eyes on the change that hands a grant to
 * another address. Two presses in the enrolment's window: what it hands over outlives the session giving it.
 */
export function AdminBerechtigungGenehmigenPanel({
  adresse,
  adresswechsel,
}: {
  adresse: string | null;
  adresswechsel: FLBerechtigungAdresswechsel;
}) {
  // The enrolment's window, as the action's: the prompt asks before a press the server would refuse.
  const twoPress = useTwoPressConfirm({ stepUp: "enrolment" });
  const router = useRouter();
  const { isConfirming, press } = twoPress;

  const handleGenehmigen = () => {
    const landing = focusAfterWrite();
    press(async () => {
      // A rejected action may still have saved, and uncaught here it takes the page down with it.
      const res = await genehmigeAdresswechselAction({ id: adresswechsel.id }).catch(rejectedWrite(router));

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
        {adresswechsel.bestaetigt ? "Sie ist bestätigt." : "Sie ist noch nicht bestätigt."} Genehmigen bis{" "}
        {adresswechselZeitpunkt(adresswechsel.bis)}.
      </p>
      <p className="fluid-sm text-pretty text-foreground">{begonnen(adresswechsel)}</p>

      {isConfirming && (
        <ConfirmReveal>
          {/* The approver is the second pair of eyes a pretext has to get past, so the press asks for the check it stands for. */}
          <p className="fluid-xxs leading-normal font-medium text-foreground">
            Mit Deiner Genehmigung wechselt der Zugang zur Verwaltung zur neuen Adresse
            {adresswechsel.bestaetigt ? ", sobald keine Wartezeit mehr läuft" : ", sobald sie bestätigt ist"}. Genehmige nur, wenn Du sicher
            bist, dass die Person die Änderung selbst angefragt hat.
          </p>
        </ConfirmReveal>
      )}

      <ConfirmActionRow confirm={twoPress}>
        <FocusSlot name="genehmigen">
          <ConfirmPressButton
            confirm={twoPress}
            reason={adresswechsel.verwehrt === null ? null : VERWEHRT[adresswechsel.verwehrt]}
            resting={AENDERUNG_GENEHMIGEN}
            // Named by its row, so each control in the list is one a screen reader can tell from the next.
            restingName={`${AENDERUNG_GENEHMIGEN}: ${adresse ?? neueAdresse(adresswechsel)}`}
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
