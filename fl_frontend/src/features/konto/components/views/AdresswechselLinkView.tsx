"use client";

import { useState, useTransition } from "react";
import Link from "next/link";

import CircleCheck from "@gravity-ui/icons/CircleCheck";

import { Button } from "@heroui/react/button";

import { ADRESSWECHSEL_GUELTIG_STUNDEN, adresswechselZeitpunkt } from "@/core/adresswechsel";
import { ADRESSWECHSEL_STOPPEN, JA_MEINE_ADRESSE, NICHT_MEINE_ADRESSE } from "@/core/adresswechselAntworten";
import { KONTAKT_EMAIL } from "@/core/brand";
import { KONTO_HREF } from "@/core/kontoHref";
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
import { totStand } from "@/features/konto/adresswechselLink";
import { DISPLAY_HEADING_CLASSES } from "@/shared/components/ui/displayType";
import { ctaButton, formButton } from "@/shared/components/ui/formButtons";
import { appToast } from "@/shared/utils/appToast";
import { ANTWORT_UNKLAR, postPublicForm, UNKLAR_TITEL } from "@/shared/utils/publicSubmit";

import type { AdresswechselLinkZustand, AdresswechselStart, AdresswechselStoppZustand } from "@/features/konto/adresswechselLink";
import type { PublicEnvelope } from "@/shared/utils/publicSubmit";

type Antwort = "bestaetigt" | "abgelehnt" | "gestoppt";

/** Each lane's route handler: the token is looked up in the collection that carries the change. */
export type AdresswechselRoute = "/api/bestaetigung/spieler/adresse" | "/api/bestaetigung/schiedsrichter/adresse";

type Stand = AdresswechselStart | { zustand: "bestaetigt"; wirksamAb: string | null } | { zustand: "abgelehnt" | "gestoppt" };

type AdresswechselAntwort =
  { success: true; antwort: Antwort; wirksam_ab: string | null } | (PublicEnvelope & { success: false; zustand?: AdresswechselLinkZustand });

const STOPP_TITEL = "Änderung Deiner E-Mail-Adresse";

/** One heading per state. A barred link's page has none. */
const TITEL: Record<Exclude<Stand["zustand"], "gesperrt">, string> = {
  gueltig: "Neue E-Mail-Adresse bestätigen",
  freigabe_offen: STOPP_TITEL,
  offen: STOPP_TITEL,
  wartezeit: STOPP_TITEL,
  bestaetigt: "Adresse bestätigt",
  abgelehnt: "Adresse entfernt",
  gestoppt: "Änderung gestoppt",
  abgelaufen: "Link abgelaufen",
  nicht_bestaetigbar: "Änderung nicht mehr möglich",
  ungueltig: "Link ungültig",
  unlesbar: LINK_UNLESBAR_TITEL,
};

/** Sends one answer through the link and hands its outcome to the page: a result, or the state a refused press leaves the link in. */
function useAntwort(route: AdresswechselRoute, token: string, onAbschluss: (stand: Stand) => void) {
  const [isPending, startSending] = useTransition();
  const [gedrueckt, setGedrueckt] = useState<Antwort | null>(null);

  const sende = (antwort: Antwort) => {
    setGedrueckt(antwort);
    startSending(async () => {
      const gesendet = await postPublicForm<AdresswechselAntwort>(route, { token: token, antwort: antwort });

      if (!gesendet.answered) {
        appToast.danger(gesendet.wroteNothing ? ANTWORT_NICHT_GESPEICHERT : UNKLAR_TITEL, { description: gesendet.error });
        return;
      }

      const body = gesendet.body;
      // Wrapped again: React leaves an update after an `await` outside the transition.
      startSending(() => {
        if (body.success) {
          onAbschluss(body.antwort === "bestaetigt" ? { zustand: "bestaetigt", wirksamAb: body.wirksam_ab } : { zustand: body.antwort });
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

type Presse = ReturnType<typeof useAntwort>;

/** The decline, the one press every link of the new mailbox still takes, worn as the action bar's exit beside the confirmation. */
function AblehnenButton({ antwort }: { antwort: Presse }) {
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

const AKTIONEN_CLASSES = "flex w-full flex-col items-stretch gap-2 sm:flex-row sm:justify-end";

function AntwortPanel({ gueltigBis, antwort }: { gueltigBis: string; antwort: Presse }) {
  const { sende, isPending, gedrueckt } = antwort;

  return (
    <BestaetigungAbschnitt titel="Deine Adresse">
      {/* Naming nobody and no lane: whoever holds the link has proved no mailbox yet, and the change moves
          every record the address holds. */}
      <p className={ABSATZ_CLASSES}>
        Für ein Konto bei der Frankfurt League soll künftig diese E-Mail-Adresse gelten. Bestätigst Du sie, schreiben wir Dir hierhin, und Du
        meldest Dich mit ihr an.
      </p>
      <p className={ABSATZ_CLASSES}>
        Bis dahin gilt die bisherige Adresse. Der Link gilt bis <Wert>{adresswechselZeitpunkt(gueltigBis)}</Wert>.
      </p>
      {/* One warning whatever the address holds: telling this mailbox it holds records of its own would
          answer a stranger whether an address is known here. */}
      <p className={ABSATZ_CLASSES}>
        Bestätige nur, wenn Du diese Änderung selbst angefragt hast. Stehen unter dieser Adresse schon Einträge bei uns, gehören danach alle zu
        einer Anmeldung.
      </p>
      <div className={AKTIONEN_CLASSES}>
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
 * nobody proved past its deadline and whatever the ban list holds (`docs/frontend/spec.md :: I630`).
 */
function NurAblehnen({ antwort }: { antwort: Presse }) {
  return (
    <BestaetigungAbschnitt titel="Deine Adresse">
      <p className={ABSATZ_CLASSES}>Ist das nicht Deine Adresse, entfernen wir sie sofort.</p>
      <div className={AKTIONEN_CLASSES}>
        <AblehnenButton antwort={antwort} />
      </div>
    </BestaetigungAbschnitt>
  );
}

/**
 * The stop link of the address on file, in every state the change can stand in: a stop hands nothing
 * over, so it is offered as the decline is. The approval is never here, needing a fresh sign-in.
 */
function StoppPanel({ zustand, wirksamAb, antwort }: { zustand: AdresswechselStoppZustand; wirksamAb: string | null; antwort: Presse }) {
  const { sende, isPending } = antwort;

  return (
    <BestaetigungAbschnitt titel="Deine Adresse">
      {zustand === "freigabe_offen" && (
        <p className={ABSATZ_CLASSES}>
          Die Verwaltung hat eine neue E-Mail-Adresse für Dich eingetragen. Sie gilt erst, wenn Du sie in Deinem Konto freigibst: Melde Dich
          dazu mit dieser Adresse an. Hast Du das nicht angefragt, stoppe die Änderung hier.
        </p>
      )}
      {/* A waiting time names its instant; served without one, it reads as the change it otherwise is. */}
      {(zustand === "offen" || (zustand === "wartezeit" && wirksamAb === null)) && (
        <p className={ABSATZ_CLASSES}>
          Für Dein Konto soll eine neue E-Mail-Adresse gelten, sobald sie bestätigt ist. Hast Du das nicht selbst angefragt, stoppe die
          Änderung. Dann bleibt diese Adresse.
        </p>
      )}
      {zustand === "wartezeit" && wirksamAb !== null && (
        <p className={ABSATZ_CLASSES}>
          Für Dein Konto soll ab <Wert>{adresswechselZeitpunkt(wirksamAb)}</Wert> eine neue E-Mail-Adresse gelten. Hast Du das nicht angefragt,
          stoppe die Änderung. Dann bleibt diese Adresse.
        </p>
      )}
      <div className={AKTIONEN_CLASSES}>
        {zustand === "freigabe_offen" && (
          <Link
            href={KONTO_HREF}
            prefetch={false}
            className={ctaButton({ intent: "outline", hover: "css" })}>
            Zu Deinem Konto
          </Link>
        )}
        <Button
          type="button"
          isPending={isPending}
          onPress={() => sende("gestoppt")}
          className={formButton({ intent: "destructive", stacks: true })}>
          {ADRESSWECHSEL_STOPPEN}
        </Button>
      </div>
    </BestaetigungAbschnitt>
  );
}

/** One page for every state an address link can be in, either lane's and either side's: the token says which. */
export function AdresswechselLinkView({ route, start }: { route: AdresswechselRoute; start: AdresswechselStart }) {
  const [stand, setStand] = useState<Stand>(start);
  const { ergebnisRef, beantwortet } = useLinkSeite(stand.zustand);
  const onAbschluss = (naechster: Stand) => {
    beantwortet();
    setStand(naechster);
  };
  // Every state holding a token sends through it; a state without one renders no press.
  const antwort = useAntwort(route, "token" in stand ? stand.token : "", onAbschluss);

  if (stand.zustand === "gesperrt") return <AdresseGesperrt panelRef={ergebnisRef} />;

  return (
    <section className={SEITE_CLASSES}>
      <header className="flex w-full flex-col gap-3">
        <h1 className={`${DISPLAY_HEADING_CLASSES} fluid-3xl`}>{TITEL[stand.zustand]}</h1>
      </header>

      {stand.zustand === "gueltig" && (
        <AntwortPanel
          gueltigBis={stand.gueltigBis}
          antwort={antwort}
        />
      )}

      {(stand.zustand === "freigabe_offen" || stand.zustand === "offen" || stand.zustand === "wartezeit") && (
        <StoppPanel
          zustand={stand.zustand}
          wirksamAb={stand.wirksamAb}
          antwort={antwort}
        />
      )}

      {stand.zustand === "bestaetigt" && (
        <BestaetigungErgebnis
          panelRef={ergebnisRef}
          tone="erfolg">
          {stand.wirksamAb === null ? (
            <p className={ABSATZ_CLASSES}>Deine neue E-Mail-Adresse gilt jetzt. Melde Dich künftig mit ihr an.</p>
          ) : (
            <p className={ABSATZ_CLASSES}>
              Danke. Deine neue E-Mail-Adresse gilt ab <Wert>{adresswechselZeitpunkt(stand.wirksamAb)}</Wert>. Bis dahin meldest Du Dich mit der
              bisherigen an.
            </p>
          )}
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

      {stand.zustand === "gestoppt" && (
        <BestaetigungErgebnis
          panelRef={ergebnisRef}
          tone="erfolg">
          <p className={ABSATZ_CLASSES}>
            Danke. Die neue Adresse ist entfernt, diese bleibt. Wurde Dein Konto ohne Dich geändert, schreib uns an {KONTAKT_EMAIL}.
          </p>
          <ZurLiga />
        </BestaetigungErgebnis>
      )}

      {/* Told apart from the dead link: the backend serves a lapsed change as lapsed, and only a link it still holds can be. */}
      {stand.zustand === "abgelaufen" && (
        <>
          <BestaetigungErgebnis
            panelRef={ergebnisRef}
            tone="hinweis">
            <p className={ABSATZ_CLASSES}>
              Dieser Link ist abgelaufen. Ein Link gilt {String(ADRESSWECHSEL_GUELTIG_STUNDEN)} Stunden. Hast Du die Änderung selbst angefragt,
              frag sie in Deinem Konto neu an. Bis dahin gilt die bisherige Adresse.
            </p>
          </BestaetigungErgebnis>
          <NurAblehnen antwort={antwort} />
        </>
      )}

      {/* Naming neither the ban, nor another pupil holding the address: the holder of this mailbox may be a
          stranger to both. */}
      {stand.zustand === "nicht_bestaetigbar" && (
        <>
          <BestaetigungErgebnis
            panelRef={ergebnisRef}
            tone="hinweis">
            <p className={ABSATZ_CLASSES}>
              Diese Änderung der E-Mail-Adresse kann nicht mehr bestätigt werden. Fragen jederzeit per E-Mail an {KONTAKT_EMAIL}.
            </p>
          </BestaetigungErgebnis>
          <NurAblehnen antwort={antwort} />
        </>
      )}

      {/* Words true however the link died and whichever side it was: a token matching neither hash names no
          side. The commonest way here is reopening a link after its answer. */}
      {stand.zustand === "ungueltig" && (
        <BestaetigungErgebnis
          panelRef={ergebnisRef}
          tone="hinweis">
          <p className={ABSATZ_CLASSES}>
            Dieser Link ist ungültig: Er wurde schon beantwortet oder durch einen neueren ersetzt, oder die Änderung gibt es nicht mehr.
          </p>
          <p className={ABSATZ_CLASSES}>
            Hast Du die neue Adresse schon bestätigt, gilt sie bereits oder ab dem Zeitpunkt, den wir Dir genannt haben. Sonst gilt die
            bisherige weiter. Fragen jederzeit per E-Mail an {KONTAKT_EMAIL}.
          </p>
          <FrageStellen />
        </BestaetigungErgebnis>
      )}

      {stand.zustand === "unlesbar" && <LinkUnlesbar panelRef={ergebnisRef} />}
    </section>
  );
}
