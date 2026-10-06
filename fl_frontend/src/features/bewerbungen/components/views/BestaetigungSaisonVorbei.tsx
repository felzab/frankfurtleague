"use client";

import { startTransition } from "react";

import CircleXmark from "@gravity-ui/icons/CircleXmark";

import { ABSATZ_CLASSES, Wert } from "@/features/bewerbungen/components/ui/Gefuellt";
import { ABLEHNEN_LABEL } from "@/features/bewerbungen/constants";
import { ConfirmActionRow } from "@/shared/components/ui/ConfirmActionRow";
import { ConfirmPressButton } from "@/shared/components/ui/ConfirmPressButton";
import { ConfirmReveal } from "@/shared/components/ui/ConfirmReveal";
import { useTwoPressConfirm } from "@/shared/hooks/useTwoPressConfirm";
import { appToast } from "@/shared/utils/appToast";
import { reportRefusedConfirmation } from "@/shared/utils/linkConfirmation";
import { postPublicForm, UNKLAR_TITEL } from "@/shared/utils/publicSubmit";
import { VERSUCHE_ES_ERNEUT_SATZ } from "@/shared/utils/refusal";

import { BestaetigungAbschnitt } from "./BestaetigungPanels";

import type { FLBewerbungEinwilligungAntwortPayload } from "@/features/bewerbungen/schemas";
import type { EinwilligungGeoeffnet, LinkZustand } from "@/features/bewerbungen/types";
import type { PublicEnvelope } from "@/shared/utils/publicSubmit";
import type { BestaetigungAbschluss } from "./BestaetigungFormPanel";

type WiderspruchAntwort = { success: true } | (PublicEnvelope & { success: false; zustand?: LinkZustand | "saison_vorbei" });

const NICHT_GESPEICHERT = `Dein Widerspruch wurde nicht gespeichert. ${VERSUCHE_ES_ERNEUT_SATZ}`;

/**
 * A season row's link once its season has ended or its team has left it: the backend takes no
 * confirmation there (`REQ-KONTAKT-006`) and still takes a Widerspruch, so the page offers that alone.
 */
export function BestaetigungSaisonVorbei({
  ansicht,
  token,
  onAbschluss,
}: {
  ansicht: EinwilligungGeoeffnet;
  token: string;
  onAbschluss: (abschluss: BestaetigungAbschluss) => void;
}) {
  const widerspruch = useTwoPressConfirm();

  // The label the view names, which a Widerspruch stores nowhere: the payload requires one all the same.
  const payload: FLBewerbungEinwilligungAntwortPayload = {
    token: token,
    antwort: "abgelehnt",
    geburtsdatum: null,
    whatsapp: false,
    medien: false,
    text_version: ansicht.laufende_fassung,
  };

  const sende = async (): Promise<void> => {
    const gesendet = await postPublicForm<WiderspruchAntwort>("/api/bestaetigung/kontakt", payload);

    if (!gesendet.answered) {
      appToast.danger(gesendet.wroteNothing ? "Widerspruch nicht gespeichert" : UNKLAR_TITEL, {
        description: gesendet.error,
      });
      return;
    }

    const antwort = gesendet.body;

    // Wrapped again: React leaves an update after an `await` outside the transition that awaited.
    startTransition(() => {
      if (antwort.success) {
        onAbschluss({ zustand: "widersprochen-neu" });
        return;
      }
      reportRefusedConfirmation(antwort, {
        onZustand: (zustand) => onAbschluss({ zustand }),
        onRefusal: () =>
          appToast.danger("Widerspruch nicht gespeichert", { description: antwort.error ?? antwort.unplacedError ?? NICHT_GESPEICHERT }),
      });
    });
  };

  return (
    <BestaetigungAbschnitt titel="Deine Antwort">
      {/* The one cause the view names, as the mail names it. Only a withdrawal reads apart: an ended
          season outranks it, so every other state this page opens on is an ended season. */}
      <p className={ABSATZ_CLASSES}>
        {ansicht.zeile === "ausgetreten" ? (
          <>
            Das Team <Wert>{ansicht.schule}</Wert> spielt in der Saison <Wert>{ansicht.saison_id}</Wert> nicht mehr mit.
          </>
        ) : (
          <>
            Die Saison <Wert>{ansicht.saison_id}</Wert> ist für das Team <Wert>{ansicht.schule}</Wert> vorbei.
          </>
        )}{" "}
        Deinen Eintrag kannst Du deshalb nicht mehr bestätigen.
      </p>
      <p className={ABSATZ_CLASSES}>
        Möchtest Du dort nicht eingetragen bleiben, kannst Du widersprechen. Dann entfernen wir Deine Angaben aus dem Eintrag.
      </p>

      <div className="flex w-full flex-col gap-y-3">
        <ConfirmActionRow confirm={widerspruch}>
          <ConfirmPressButton
            confirm={widerspruch}
            // Nothing closes this press: the backend takes a Widerspruch until the link's own deadline.
            reason={null}
            resting={ABLEHNEN_LABEL}
            armed="Widerspruch senden"
            running="Sendet..."
            icon={
              <CircleXmark
                className="size-4.5"
                aria-hidden="true"
              />
            }
            onPress={() => widerspruch.press(sende)}
          />
        </ConfirmActionRow>

        {widerspruch.isConfirming && (
          <ConfirmReveal>
            <p className="fluid-xxs leading-normal font-medium text-foreground">Wir entfernen Deine Angaben sofort aus dem Eintrag.</p>
          </ConfirmReveal>
        )}
      </div>
    </BestaetigungAbschnitt>
  );
}
