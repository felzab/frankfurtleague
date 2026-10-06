"use client";

import { useState, useTransition } from "react";

import CircleCheck from "@gravity-ui/icons/CircleCheck";

import { Button } from "@heroui/react/button";

import { KONTAKT_EMAIL } from "@/core/brand";
import { ABSATZ_CLASSES, Wert } from "@/features/bewerbungen/components/ui/Gefuellt";
import { SEITE_CLASSES } from "@/features/bewerbungen/components/ui/seite";
import {
  AdresseGesperrt,
  ANTWORT_NICHT_GESPEICHERT,
  ANTWORT_NICHT_GESPEICHERT_SATZ,
  BestaetigungAbschnitt,
  BestaetigungErgebnis,
  FrageStellen,
  LINK_UNLESBAR_TITEL,
  LinkUnlesbar,
  useLinkSeite,
  ZurLiga,
} from "@/features/bewerbungen/components/views/BestaetigungPanels";
import { totStand } from "@/features/schiedsrichter/adresswechselStart";
import { SCHIEDSRICHTER_BESTAETIGUNG_FRIST_TAGE } from "@/features/schiedsrichter/constants";
import { DISPLAY_HEADING_CLASSES } from "@/shared/components/ui/displayType";
import { formButton } from "@/shared/components/ui/formButtons";
import { appToast } from "@/shared/utils/appToast";
import { formatSpielDatum } from "@/shared/utils/format";
import { ANTWORT_UNKLAR, postPublicForm, UNKLAR_TITEL } from "@/shared/utils/publicSubmit";

import type { SchiedsrichterAdresswechselStart } from "@/features/schiedsrichter/adresswechselStart";
import type { AdresswechselLinkZustand } from "@/features/schiedsrichter/types";
import type { PublicEnvelope } from "@/shared/utils/publicSubmit";

type Antwort = "bestaetigt" | "abgelehnt";

type Stand = SchiedsrichterAdresswechselStart | { zustand: Antwort };

type AdresswechselAntwort = { success: true; antwort: Antwort } | (PublicEnvelope & { success: false; zustand?: AdresswechselLinkZustand });

/** One heading per state, in the consent page's words where the state is the same one. A barred link's page has none. */
const TITEL: Record<Exclude<Stand["zustand"], "gesperrt">, string> = {
  gueltig: "Neue E-Mail-Adresse bestätigen",
  bestaetigt: "Adresse bestätigt",
  abgelehnt: "Adresse entfernt",
  abgelaufen: "Link abgelaufen",
  nicht_bestaetigbar: "Änderung nicht mehr möglich",
  ungueltig: "Link ungültig",
  unlesbar: LINK_UNLESBAR_TITEL,
};

export const JA_MEINE_ADRESSE = "Ja, das ist meine Adresse";
export const NICHT_MEINE_ADRESSE = "Das ist nicht meine Adresse";

/** Sends one answer through the link and hands its outcome to the page: a result, or the state a refused press leaves the link in. */
function useAntwort(token: string, onAbschluss: (stand: Stand) => void) {
  const [isPending, startSending] = useTransition();
  const [gedrueckt, setGedrueckt] = useState<Antwort | null>(null);

  const sende = (antwort: Antwort) => {
    setGedrueckt(antwort);
    startSending(async () => {
      const gesendet = await postPublicForm<AdresswechselAntwort>("/api/bestaetigung/schiedsrichter/adresse", {
        token: token,
        antwort: antwort,
      });

      if (!gesendet.answered) {
        appToast.danger(gesendet.wroteNothing ? ANTWORT_NICHT_GESPEICHERT : UNKLAR_TITEL, { description: gesendet.error });
        return;
      }

      const body = gesendet.body;
      // Wrapped again, for the consent page's reason: React leaves an update after an `await` outside the transition.
      startSending(() => {
        if (body.success) {
          onAbschluss({ zustand: body.antwort });
          return;
        }
        if (body.outcome === "unknown") {
          appToast.danger(UNKLAR_TITEL, { description: ANTWORT_UNKLAR });
          return;
        }
        // The link died between the open and the press: the answer is the panel, never a toast.
        if (body.zustand !== undefined) {
          onAbschluss(totStand(body.zustand, token));
          return;
        }
        appToast.danger(ANTWORT_NICHT_GESPEICHERT, { description: body.error ?? body.unplacedError ?? ANTWORT_NICHT_GESPEICHERT_SATZ });
      });
    });
  };

  return { sende: sende, isPending: isPending, gedrueckt: gedrueckt };
}

/**
 * The decline, the one press every link a referee still holds takes, worn as the contact page wears
 * its Widerspruch (`BestaetigungFormPanel.tsx`): the action bar's exit, beside and after the confirmation.
 */
function AblehnenButton({ antwort }: { antwort: ReturnType<typeof useAntwort> }) {
  const { sende, isPending, gedrueckt } = antwort;

  return (
    <Button
      type="button"
      variant="secondary"
      isPending={isPending && gedrueckt === "abgelehnt"}
      isDisabled={isPending}
      onPress={() => sende("abgelehnt")}
      className={formButton({ intent: "cancel", stacks: true })}>
      {NICHT_MEINE_ADRESSE}
    </Button>
  );
}

function AntwortPanel({
  vorname,
  frist,
  token,
  onAbschluss,
}: {
  vorname: string;
  frist: string;
  token: string;
  onAbschluss: (stand: Stand) => void;
}) {
  const antwort = useAntwort(token, onAbschluss);
  const { sende, isPending, gedrueckt } = antwort;

  return (
    <BestaetigungAbschnitt titel="Deine Adresse">
      <p className={ABSATZ_CLASSES}>
        Die Verwaltung der Frankfurt League hat diese E-Mail-Adresse für <Wert>{vorname}</Wert> als Schiedsrichterin oder Schiedsrichter
        eingetragen. Bestätigst Du sie, schreiben wir Dir künftig hierhin und Du meldest Dich mit ihr an.
      </p>
      <p className={ABSATZ_CLASSES}>
        Bis dahin gilt die bisherige Adresse. Der Link ist bis zum <Wert>{formatSpielDatum(frist)}</Wert> gültig.
      </p>
      <div className="flex w-full flex-col items-stretch gap-2 sm:flex-row sm:justify-end">
        <Button
          type="button"
          isPending={isPending && gedrueckt === "bestaetigt"}
          isDisabled={isPending}
          onPress={() => sende("bestaetigt")}
          className={formButton({ intent: "submit", stacks: true })}>
          <CircleCheck
            className="size-4.5"
            aria-hidden="true"
          />
          {JA_MEINE_ADRESSE}
        </Button>
        <AblehnenButton antwort={antwort} />
      </div>
    </BestaetigungAbschnitt>
  );
}

/**
 * A link whose confirmation is closed: the decline stays open, since the backend removes an address
 * nobody proved however late the press and whatever the ban list holds (`docs/frontend/spec.md :: I630`).
 */
function NurAblehnen({ token, onAbschluss }: { token: string; onAbschluss: (stand: Stand) => void }) {
  const antwort = useAntwort(token, onAbschluss);

  return (
    <BestaetigungAbschnitt titel="Deine Adresse">
      <p className={ABSATZ_CLASSES}>Ist das nicht Deine Adresse, entfernen wir sie sofort.</p>
      <div className="flex w-full flex-col items-stretch gap-2 sm:flex-row sm:justify-end">
        <AblehnenButton antwort={antwort} />
      </div>
    </BestaetigungAbschnitt>
  );
}

/** One page for every state an address link can be in, framed as the consent link's page is. */
export function SchiedsrichterAdresswechselView({ start }: { start: SchiedsrichterAdresswechselStart }) {
  const [stand, setStand] = useState<Stand>(start);
  const { ergebnisRef, beantwortet } = useLinkSeite(stand.zustand);
  const onAbschluss = (naechster: Stand) => {
    beantwortet();
    setStand(naechster);
  };

  if (stand.zustand === "gesperrt") return <AdresseGesperrt panelRef={ergebnisRef} />;

  return (
    <section className={SEITE_CLASSES}>
      <header className="flex w-full flex-col gap-3">
        <h1 className={`${DISPLAY_HEADING_CLASSES} fluid-3xl`}>{TITEL[stand.zustand]}</h1>
      </header>

      {stand.zustand === "gueltig" && (
        <AntwortPanel
          vorname={stand.vorname}
          frist={stand.frist}
          token={stand.token}
          onAbschluss={onAbschluss}
        />
      )}

      {stand.zustand === "bestaetigt" && (
        <BestaetigungErgebnis
          panelRef={ergebnisRef}
          tone="erfolg">
          <p className={ABSATZ_CLASSES}>Deine neue E-Mail-Adresse gilt jetzt. Melde Dich künftig mit ihr an.</p>
          {/* A passkey belongs to the account of the address it was set up under, which the move leaves behind. */}
          <p className={ABSATZ_CLASSES}>
            Hattest Du für die bisherige Adresse einen Passkey eingerichtet, gilt er für die neue nicht: Richte nach der Anmeldung in Deinem
            Konto einen neuen ein.
          </p>
          <ZurLiga />
        </BestaetigungErgebnis>
      )}

      {stand.zustand === "abgelehnt" && (
        <BestaetigungErgebnis
          panelRef={ergebnisRef}
          tone="erfolg">
          <p className={ABSATZ_CLASSES}>Danke. Wir haben die Adresse wieder entfernt.</p>
          <ZurLiga />
        </BestaetigungErgebnis>
      )}

      {/* Told apart from the dead link, which the consent page cannot do: the backend serves a lapsed
          change as lapsed, and only a link it still holds can be. */}
      {stand.zustand === "abgelaufen" && (
        <>
          <BestaetigungErgebnis
            panelRef={ergebnisRef}
            tone="hinweis">
            <p className={ABSATZ_CLASSES}>
              Dieser Link ist abgelaufen. Ein Link gilt {String(SCHIEDSRICHTER_BESTAETIGUNG_FRIST_TAGE)} Tage; einen neuen schickt Dir die
              Verwaltung, wenn Du an {KONTAKT_EMAIL} schreibst. Bis dahin gilt die bisherige Adresse.
            </p>
          </BestaetigungErgebnis>
          <NurAblehnen
            token={stand.token}
            onAbschluss={onAbschluss}
          />
        </>
      )}

      {/* Naming neither the ban nor the address it holds: the holder of this mailbox may be a stranger to
          both (`REQ-SCHIEDSRICHTER-010`). */}
      {stand.zustand === "nicht_bestaetigbar" && (
        <>
          <BestaetigungErgebnis
            panelRef={ergebnisRef}
            tone="hinweis">
            <p className={ABSATZ_CLASSES}>
              Diese Änderung der E-Mail-Adresse kann nicht mehr bestätigt werden. Fragen jederzeit per E-Mail an {KONTAKT_EMAIL}.
            </p>
          </BestaetigungErgebnis>
          <NurAblehnen
            token={stand.token}
            onAbschluss={onAbschluss}
          />
        </>
      )}

      {/* Words true however the link died: the commonest way here is reopening it after a confirmation,
          which already moved the address, and a decline, a newer link or a discard left the old one. */}
      {stand.zustand === "ungueltig" && (
        <BestaetigungErgebnis
          panelRef={ergebnisRef}
          tone="hinweis">
          <p className={ABSATZ_CLASSES}>
            Dieser Link ist ungültig: Er wurde schon beantwortet oder durch einen neueren ersetzt, oder die Änderung gibt es nicht mehr.
          </p>
          <p className={ABSATZ_CLASSES}>
            Hast Du die neue Adresse schon bestätigt, gilt sie bereits; sonst gilt die bisherige weiter. Fragen jederzeit per E-Mail an{" "}
            {KONTAKT_EMAIL}.
          </p>
          <FrageStellen />
        </BestaetigungErgebnis>
      )}

      {stand.zustand === "unlesbar" && <LinkUnlesbar panelRef={ergebnisRef} />}
    </section>
  );
}
