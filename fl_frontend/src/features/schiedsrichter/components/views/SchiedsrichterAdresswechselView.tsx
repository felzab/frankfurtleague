"use client";

import { useState, useTransition } from "react";

import CircleCheck from "@gravity-ui/icons/CircleCheck";
import CircleXmark from "@gravity-ui/icons/CircleXmark";

import { Button } from "@heroui/react/button";

import { KONTAKT_EMAIL } from "@/core/brand";
import { ABSATZ_CLASSES, Wert } from "@/features/bewerbungen/components/ui/Gefuellt";
import { SEITE_CLASSES } from "@/features/bewerbungen/components/ui/seite";
import {
  AdresseGesperrt,
  BestaetigungAbschnitt,
  BestaetigungErgebnis,
  FrageStellen,
  useLinkSeite,
  ZurLiga,
} from "@/features/bewerbungen/components/views/BestaetigungPanels";
import { SCHIEDSRICHTER_BESTAETIGUNG_FRIST_TAGE } from "@/features/schiedsrichter/constants";
import { DISPLAY_HEADING_CLASSES } from "@/shared/components/ui/displayType";
import { formButton } from "@/shared/components/ui/formButtons";
import { appToast } from "@/shared/utils/appToast";
import { formatSpielDatum } from "@/shared/utils/format";
import { ANTWORT_UNKLAR, postPublicForm, UNKLAR_TITEL } from "@/shared/utils/publicSubmit";
import { VERSUCHE_ES_ERNEUT_SATZ } from "@/shared/utils/refusal";

import type { AdresswechselLinkZustand } from "@/features/schiedsrichter/types";
import type { PublicEnvelope } from "@/shared/utils/publicSubmit";

type Antwort = "bestaetigt" | "abgelehnt";

/** What the page opens on. The token rides only with a link a press can still spend, for the consent page's reason. */
export type SchiedsrichterAdresswechselStart =
  { zustand: "gueltig"; vorname: string; frist: string; token: string } | { zustand: AdresswechselLinkZustand | "unlesbar" };

type Stand = SchiedsrichterAdresswechselStart | { zustand: Antwort };

type AdresswechselAntwort = { success: true; antwort: Antwort } | (PublicEnvelope & { success: false; zustand?: AdresswechselLinkZustand });

/** One heading per state, in the consent page's words where the state is the same one. A barred link's page has none. */
const TITEL: Record<Exclude<Stand["zustand"], "gesperrt">, string> = {
  gueltig: "Neue E-Mail-Adresse bestätigen",
  bestaetigt: "Adresse bestätigt",
  abgelehnt: "Adresse entfernt",
  abgelaufen: "Link ungültig",
  ungueltig: "Link ungültig",
  unlesbar: "Link nicht geprüft",
};

/** This page's own word for the failure, for the consent page's reason. */
const ANTWORT_NICHT_GESPEICHERT = "Antwort nicht gespeichert";
const NICHT_GESPEICHERT = `Deine Antwort wurde nicht gespeichert. ${VERSUCHE_ES_ERNEUT_SATZ}`;

export const JA_MEINE_ADRESSE = "Ja, das ist meine Adresse";
export const NICHT_MEINE_ADRESSE = "Das ist nicht meine Adresse";

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
          onAbschluss({ zustand: body.zustand });
          return;
        }
        appToast.danger(ANTWORT_NICHT_GESPEICHERT, { description: body.error ?? body.unplacedError ?? NICHT_GESPEICHERT });
      });
    });
  };

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
          isPending={isPending && gedrueckt === "abgelehnt"}
          isDisabled={isPending}
          onPress={() => sende("abgelehnt")}
          className={formButton({ intent: "nav", stacks: true })}>
          <CircleXmark
            className="size-4.5"
            aria-hidden="true"
          />
          {NICHT_MEINE_ADRESSE}
        </Button>
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
      </div>
    </BestaetigungAbschnitt>
  );
}

/** One page for every state an address link can be in, framed as the consent link's page is. */
export function SchiedsrichterAdresswechselView({ start }: { start: SchiedsrichterAdresswechselStart }) {
  const [stand, setStand] = useState<Stand>(start);
  const { ergebnisRef, beantwortet } = useLinkSeite(stand.zustand);

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
          onAbschluss={(naechster) => {
            beantwortet();
            setStand(naechster);
          }}
        />
      )}

      {stand.zustand === "bestaetigt" && (
        <BestaetigungErgebnis
          panelRef={ergebnisRef}
          tone="erfolg">
          <p className={ABSATZ_CLASSES}>Deine neue E-Mail-Adresse gilt jetzt. Melde Dich künftig mit ihr an.</p>
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

      {/* One wording for both, for the consent page's reason: a replaced or answered link and a
          lapsed one cannot be told apart after the fact without telling a guessed link more. */}
      {(stand.zustand === "abgelaufen" || stand.zustand === "ungueltig") && (
        <BestaetigungErgebnis
          panelRef={ergebnisRef}
          tone="hinweis">
          <p className={ABSATZ_CLASSES}>
            Dieser Link ist ungültig oder abgelaufen. Ein Link gilt {String(SCHIEDSRICHTER_BESTAETIGUNG_FRIST_TAGE)} Tage, und ein neuer ersetzt
            jeden früheren.
          </p>
          <p className={ABSATZ_CLASSES}>Deine bisherige Adresse gilt weiter. Fragen jederzeit per E-Mail an {KONTAKT_EMAIL}.</p>
          <FrageStellen />
        </BestaetigungErgebnis>
      )}

      {stand.zustand === "unlesbar" && (
        <BestaetigungErgebnis
          panelRef={ergebnisRef}
          tone="hinweis">
          <p className={ABSATZ_CLASSES}>
            Wir können diesen Link gerade nicht prüfen. Lade die Seite in ein paar Minuten neu, oder schreib uns.
          </p>
          <FrageStellen />
        </BestaetigungErgebnis>
      )}
    </section>
  );
}
