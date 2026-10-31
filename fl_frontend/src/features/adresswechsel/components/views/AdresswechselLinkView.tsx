"use client";

import { useState, useTransition } from "react";
import Link from "next/link";

import CircleCheck from "@gravity-ui/icons/CircleCheck";

import { Button } from "@heroui/react/button";

import { ADRESSWECHSEL_GUELTIG_STUNDEN, ADRESSWECHSEL_WARTEZEIT_DAUER } from "@/core/adresswechsel";
import { ADRESSWECHSEL_STOPPEN } from "@/core/adresswechselAntworten";
import { KONTAKT_EMAIL } from "@/core/brand";
import { formatInstant } from "@/core/format";
import { KONTO_HREF } from "@/core/kontoHref";
import { startOf } from "@/features/adresswechsel/link";
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
import { DISPLAY_HEADING_CLASSES } from "@/shared/components/ui/displayType";
import { ctaButton, formButton } from "@/shared/components/ui/formButtons";
import { appToast } from "@/shared/utils/appToast";
import { ANTWORT_UNKLAR, postPublicForm, UNKLAR_TITEL } from "@/shared/utils/publicSubmit";

import type { FLAddressChangeEndArt, FLAddressChangeViewPreviousState, FLAddressChangeWay } from "@/core/generated/client/types";
import type { AdresswechselAnsicht, AdresswechselGedrueckt, AdresswechselLinkZustand, AdresswechselStart } from "@/features/adresswechsel/link";
import type { PublicEnvelope } from "@/shared/utils/publicSubmit";

type Antwort = AdresswechselGedrueckt["antwort"];

type Beendet = Extract<AdresswechselAnsicht, { zustand: "ended" }>;

/** The one route handler, which finds the change by the token's hash on either side. */
const ROUTE = "/api/bestaetigung/adresse";

type AdresswechselAntwort =
  AdresswechselGedrueckt | (PublicEnvelope & { success: false; zustand?: AdresswechselLinkZustand; ansicht?: AdresswechselAnsicht | null });

/**
 * The new mailbox's confirmation, asking about the change and never about the mailbox: the holder of an address the league
 * already writes to owns it truthfully, and would hand a stranger's records over by agreeing to that.
 */
const JA_ANGEFRAGT = "Ja, ich habe diese Änderung angefragt";

const NICHT_MEINE_ADRESSE = "Das ist nicht meine Adresse";

const STOPP_TITEL = "Änderung Deiner E-Mail-Adresse";

/** One heading per live state. A barred link's page has none; an ended change's heading is its side's and its end's. */
const TITEL: Record<Exclude<AdresswechselStart["zustand"], "barred" | "ended">, string> = {
  valid: "Neue E-Mail-Adresse bestätigen",
  confirmed: "Adresse bestätigt",
  release_open: STOPP_TITEL,
  open: STOPP_TITEL,
  approval: STOPP_TITEL,
  waiting_period: STOPP_TITEL,
  expired: "Link abgelaufen",
  // The heading the change's tombstone reads once the hourly pass has ended it.
  approval_expired: "Änderung abgelaufen",
  not_confirmable: "Bestätigung gerade nicht möglich",
  invalid: "Link ungültig",
  unlesbar: LINK_UNLESBAR_TITEL,
};

/**
 * How an ended change reads from each side. A link answers after the end, so the holder of the address on file
 * learns that a change took effect rather than being told the address still holds.
 */
const ENDE: Record<FLAddressChangeEndArt, Record<Beendet["seite"], { titel: string; satz: string }>> = {
  effective: {
    new: { titel: "Adresse bestätigt", satz: "Die neue E-Mail-Adresse gilt jetzt. Melde Dich mit ihr neu an." },
    previous: {
      titel: "Änderung wirksam",
      satz: `Für das Konto gilt inzwischen eine neue E-Mail-Adresse. Hast Du das nicht veranlasst? Schreib uns sofort an ${KONTAKT_EMAIL}.`,
    },
  },
  declined: {
    new: { titel: "Adresse entfernt", satz: "Diese Adresse ist aus der Änderung entfernt und wird nicht übernommen." },
    previous: { titel: "Änderung beendet", satz: "Die neue Adresse wurde nicht bestätigt. Diese Adresse bleibt." },
  },
  stopped: {
    new: { titel: "Änderung gestoppt", satz: "Die Änderung wurde gestoppt. Diese Adresse wird nicht übernommen." },
    previous: {
      titel: "Änderung gestoppt",
      satz: `Die neue Adresse ist entfernt, diese bleibt. Hast Du die Änderung nicht selbst angefragt, schreib uns an ${KONTAKT_EMAIL}.`,
    },
  },
  expired: {
    new: { titel: "Änderung abgelaufen", satz: "Die Änderung ist abgelaufen und gelöscht. Diese Adresse wird nicht übernommen." },
    previous: { titel: "Änderung abgelaufen", satz: "Die Änderung ist abgelaufen und gelöscht. Diese Adresse bleibt." },
  },
  replaced: {
    // A newer change waiting on the address on file's approval has mailed no link yet, so none is promised.
    new: {
      titel: "Link ersetzt",
      satz: "Diese Änderung wurde durch eine neuere ersetzt. Gilt die neuere Dir, nimm nur einen Link aus einer späteren E-Mail.",
    },
    previous: {
      titel: "Änderung ersetzt",
      satz: "Diese Änderung wurde durch eine neuere ersetzt, zu der diese Adresse einen eigenen Hinweis bekommen hat.",
    },
  },
  discarded: {
    new: { titel: "Änderung nicht möglich", satz: `Diese Änderung wird nicht ausgeführt. Fragen jederzeit per E-Mail an ${KONTAKT_EMAIL}.` },
    previous: { titel: "Änderung beendet", satz: "Die Änderung wird nicht ausgeführt. Diese Adresse bleibt." },
  },
};

/**
 * A tombstone names no way, so this holds for both: the account follows where the address on file asked for or
 * approved the change, and never after a lost mailbox, whose holder may be a stranger.
 */
const PASSKEY_SATZ =
  "Klappt die Anmeldung mit Deinem bisherigen Passkey nicht, melde Dich mit einem Code an die neue Adresse an und richte in Deinem Konto einen neuen ein.";

/** What the new mailbox's holder does once the change takes effect, told before it does. */
const DANACH: Readonly<Record<FLAddressChangeWay, string>> = {
  // Never "Deine Passkeys gelten weiter": a sign-in account already standing at the new address keeps them behind, and no
  // served field tells this page so.
  account: `Bis dahin meldest Du Dich mit der bisherigen an. Danach meldest Du Dich überall neu an. ${PASSKEY_SATZ}`,
  release: `Bis dahin meldest Du Dich mit der bisherigen an. Danach meldest Du Dich überall neu an. ${PASSKEY_SATZ}`,
  waiting_period:
    "Bis dahin gilt die bisherige Adresse. Danach meldest Du Dich mit einem Code an die neue an. Passkeys der bisherigen gelten dann nicht mehr: Richte in Deinem Konto einen neuen ein.",
};

/** The state a press's answer leaves the page in, the side being the press's own. */
function nachDruck(antwort: AdresswechselGedrueckt, way: FLAddressChangeWay): AdresswechselStart {
  if (antwort.antwort === "declined") return { zustand: "ended", seite: "new", art: "declined" };
  if (antwort.antwort === "stopped") return { zustand: "ended", seite: "previous", art: "stopped" };
  if (antwort.effective) return { zustand: "ended", seite: "new", art: "effective" };

  return { zustand: "confirmed", wirksamAb: antwort.effective_from, genehmigungOffen: antwort.approval_open, way: way };
}

/** Sends one answer through the link and hands its outcome to the page: a result, or the state a refused press leaves the link in. */
function useAntwort(start: AdresswechselStart, onAbschluss: (stand: AdresswechselStart) => void) {
  const [isPending, startSending] = useTransition();
  const [gedrueckt, setGedrueckt] = useState<Antwort | null>(null);
  const token = "token" in start ? start.token : "";
  const way = "way" in start ? start.way : "account";

  const sende = (antwort: Antwort) => {
    setGedrueckt(antwort);
    startSending(async () => {
      const gesendet = await postPublicForm<AdresswechselAntwort>(ROUTE, { token: token, antwort: antwort });

      if (!gesendet.answered) {
        appToast.danger(gesendet.wroteNothing ? ANTWORT_NICHT_GESPEICHERT : UNKLAR_TITEL, { description: gesendet.error });
        return;
      }

      const body = gesendet.body;
      // Wrapped again: React leaves an update after an `await` outside the transition.
      startSending(() => {
        if (body.success) {
          onAbschluss(nachDruck(body, way));
          return;
        }
        if (body.outcome === "unknown") {
          appToast.danger(UNKLAR_TITEL, { description: ANTWORT_UNKLAR });
          return;
        }
        // The change moved between the open and the press: the answer is the panel, never a toast.
        if (body.ansicht !== undefined) {
          onAbschluss(body.ansicht === null ? { zustand: "unlesbar" } : startOf(body.ansicht, token));
          return;
        }
        if (body.zustand !== undefined) {
          const zustand = body.zustand;
          // The decline stays open on these two, so their panel keeps the token.
          onAbschluss(zustand === "expired" || zustand === "not_confirmable" ? { zustand, way: way, token } : { zustand });
          return;
        }
        appToast.danger(ANTWORT_NICHT_GESPEICHERT, { description: body.error ?? body.unplacedError ?? ANTWORT_NICHT_GESPEICHERT_SATZ });
      });
    });
  };

  return { sende: sende, isPending: isPending, gedrueckt: gedrueckt };
}

type Presse = ReturnType<typeof useAntwort>;

/** The decline, the one press every live link of the new mailbox still takes, worn as the action bar's exit beside the confirmation. */
function AblehnenButton({ antwort }: { antwort: Presse }) {
  const { sende, isPending, gedrueckt } = antwort;

  return (
    <Button
      type="button"
      variant="secondary"
      isPending={isPending && gedrueckt === "declined"}
      isDisabled={isPending}
      onPress={() => sende("declined")}
      className={formButton({ intent: "cancel", stacks: true })}>
      {NICHT_MEINE_ADRESSE}
    </Button>
  );
}

const AKTIONEN_CLASSES = "flex w-full flex-col items-stretch gap-2 sm:flex-row sm:justify-end";

function AntwortPanel({ gueltigBis, way: way, antwort }: { gueltigBis: string; way: FLAddressChangeWay; antwort: Presse }) {
  const { sende, isPending, gedrueckt } = antwort;

  return (
    <BestaetigungAbschnitt titel="Deine Adresse">
      {/* Naming nobody and no record: whoever holds the link has proved no mailbox yet, and the change moves
          every record the address holds. */}
      <p className={ABSATZ_CLASSES}>
        Für ein Konto bei der Frankfurt League soll künftig diese E-Mail-Adresse gelten. Bestätigst Du sie, schreiben wir Dir hierhin, und Du
        meldest Dich mit ihr an.
        {way === "waiting_period" && ` Sie gilt ${ADRESSWECHSEL_WARTEZEIT_DAUER} nach Deiner Bestätigung.`}
      </p>
      <p className={ABSATZ_CLASSES}>
        Bis dahin gilt die bisherige Adresse. Der Link gilt bis <Wert>{formatInstant(gueltigBis)}</Wert>.
      </p>
      <p className={ABSATZ_CLASSES}>Bestätige nur, wenn Du diese Änderung selbst angefragt hast.</p>
      <div className={AKTIONEN_CLASSES}>
        <Button
          type="button"
          isPending={isPending && gedrueckt === "confirmed"}
          isDisabled={isPending}
          onPress={() => sende("confirmed")}
          className={formButton({ intent: "submit", stacks: true })}>
          <CircleCheck
            className="size-4.5"
            aria-hidden="true"
          />
          {JA_ANGEFRAGT}
        </Button>
        <AblehnenButton antwort={antwort} />
      </div>
    </BestaetigungAbschnitt>
  );
}

/**
 * A link whose confirmation is closed: the decline stays open, since the backend removes an address
 * nobody proved past its deadline and whatever the ban list holds.
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

/** The stop link's sentence for each step the change waits on, by the way it began. */
function stoppSatz(zustand: FLAddressChangeViewPreviousState, way: FLAddressChangeWay, wirksamAb: string | null) {
  if (zustand === "release_open") {
    return "Die Verwaltung hat eine neue E-Mail-Adresse für Dich eingetragen. Sie gilt nur, wenn Du sie in Deinem Konto freigibst: Melde Dich dazu mit dieser Adresse an. Gib sie nur frei, wenn Du das selbst angefragt hast, und stoppe die Änderung sonst hier.";
  }
  if (zustand === "approval") {
    return "Die neue E-Mail-Adresse ist bestätigt. Sie gilt erst, wenn die Verwaltung die Änderung genehmigt hat. Bis dahin meldest Du Dich weiter mit dieser Adresse an. Hast Du das nicht angefragt, stoppe die Änderung.";
  }
  if (zustand === "waiting_period" && wirksamAb !== null) {
    return (
      <>
        Für Dein Konto soll ab <Wert>{formatInstant(wirksamAb)}</Wert> eine neue E-Mail-Adresse gelten. Hast Du das nicht angefragt, stoppe die
        Änderung. Dann bleibt diese Adresse.
      </>
    );
  }
  // Told by the way, which the read carries on this side too: a change waiting a week after its confirmation is
  // never said to take effect at the confirmation.
  if (way === "waiting_period") {
    return `Die Verwaltung hat eine neue E-Mail-Adresse für Dein Konto eingetragen, weil diese nicht mehr erreichbar sein soll. Bestätigt die neue Adresse ihren Link, gilt sie ${ADRESSWECHSEL_WARTEZEIT_DAUER} danach. Hast Du das nicht angefragt, stoppe die Änderung. Dann bleibt diese Adresse.`;
  }
  return "Für Dein Konto soll eine neue E-Mail-Adresse gelten, sobald sie bestätigt ist. Hast Du das nicht selbst angefragt, stoppe die Änderung. Dann bleibt diese Adresse.";
}

/**
 * The stop link of the address on file, in every state the change can stand in: a stop hands nothing
 * over, so it is offered as the decline is. The approval is never here, needing a fresh sign-in.
 */
function StoppPanel({
  zustand,
  way: way,
  wirksamAb,
  antwort,
}: {
  zustand: FLAddressChangeViewPreviousState;
  way: FLAddressChangeWay;
  wirksamAb: string | null;
  antwort: Presse;
}) {
  const { sende, isPending } = antwort;

  return (
    <BestaetigungAbschnitt titel="Deine Adresse">
      <p className={ABSATZ_CLASSES}>{stoppSatz(zustand, way, wirksamAb)}</p>
      <div className={AKTIONEN_CLASSES}>
        {zustand === "release_open" && (
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
          onPress={() => sende("stopped")}
          className={formButton({ intent: "destructive", stacks: true })}>
          {ADRESSWECHSEL_STOPPEN}
        </Button>
      </div>
    </BestaetigungAbschnitt>
  );
}

/** What the new mailbox is told once its link is pressed and the change still waits on its time or an approval. */
function bestaetigtSatz({ wirksamAb, genehmigungOffen }: { wirksamAb: string | null; genehmigungOffen: boolean }) {
  const ab = wirksamAb === null ? null : <Wert>{formatInstant(wirksamAb)}</Wert>;
  if (ab !== null && genehmigungOffen) {
    return <>Danke. Die neue E-Mail-Adresse gilt frühestens ab {ab}, und erst wenn die Verwaltung die Änderung genehmigt hat.</>;
  }
  if (ab !== null) return <>Danke. Die neue E-Mail-Adresse gilt ab {ab}.</>;
  if (genehmigungOffen) return "Danke. Die neue E-Mail-Adresse gilt, sobald die Verwaltung die Änderung genehmigt hat.";

  return "Danke. Die neue E-Mail-Adresse ist bestätigt.";
}

/** One page for every state an address link can be in, either side's, live or ended: the token says which. */
export function AdresswechselLinkView({ start }: { start: AdresswechselStart }) {
  const [stand, setStand] = useState<AdresswechselStart>(start);
  const { ergebnisRef, beantwortet } = useLinkSeite(stand.zustand);
  const onAbschluss = (naechster: AdresswechselStart) => {
    beantwortet();
    setStand(naechster);
  };
  // Every state holding a token sends through it; a state without one renders no press.
  const antwort = useAntwort(stand, onAbschluss);

  if (stand.zustand === "barred") return <AdresseGesperrt panelRef={ergebnisRef} />;

  const titel = stand.zustand === "ended" ? ENDE[stand.art][stand.seite].titel : TITEL[stand.zustand];

  return (
    <section className={SEITE_CLASSES}>
      <header className="flex w-full flex-col gap-3">
        <h1 className={`${DISPLAY_HEADING_CLASSES} fluid-3xl`}>{titel}</h1>
      </header>

      {stand.zustand === "valid" && (
        <AntwortPanel
          gueltigBis={stand.gueltigBis}
          way={stand.way}
          antwort={antwort}
        />
      )}

      {(stand.zustand === "release_open" || stand.zustand === "open" || stand.zustand === "approval" || stand.zustand === "waiting_period") && (
        <StoppPanel
          zustand={stand.zustand}
          way={stand.way}
          wirksamAb={stand.wirksamAb}
          antwort={antwort}
        />
      )}

      {stand.zustand === "confirmed" && (
        <BestaetigungErgebnis
          panelRef={ergebnisRef}
          tone="erfolg">
          <p className={ABSATZ_CLASSES}>{bestaetigtSatz(stand)}</p>
          {/* A lost mailbox's holder is never sent back to it to sign in, and keeps no passkey of it. */}
          <p className={ABSATZ_CLASSES}>{DANACH[stand.way]}</p>
          <ZurLiga />
        </BestaetigungErgebnis>
      )}

      {stand.zustand === "ended" && (
        <BestaetigungErgebnis
          panelRef={ergebnisRef}
          tone={stand.art === "effective" && stand.seite === "previous" ? "hinweis" : "erfolg"}>
          <p className={ABSATZ_CLASSES}>{ENDE[stand.art][stand.seite].satz}</p>
          {stand.art === "effective" && stand.seite === "new" && <p className={ABSATZ_CLASSES}>{PASSKEY_SATZ}</p>}
          <ZurLiga />
        </BestaetigungErgebnis>
      )}

      {/* Told apart from the dead link: the backend serves a lapsed change as lapsed, and only a link it still holds can be. */}
      {stand.zustand === "expired" && (
        <>
          <BestaetigungErgebnis
            panelRef={ergebnisRef}
            tone="hinweis">
            <p className={ABSATZ_CLASSES}>
              Dieser Link ist abgelaufen. Ein Link gilt {String(ADRESSWECHSEL_GUELTIG_STUNDEN)} Stunden.{" "}
              {/* Only the person's own start can be asked again on the account page; an administrator's needs the league. */}
              {stand.way === "account"
                ? "Hast Du die Änderung selbst angefragt, frag sie in Deinem Konto neu an."
                : `Brauchst Du die Änderung noch, schreib uns an ${KONTAKT_EMAIL}.`}{" "}
              Bis dahin gilt die bisherige Adresse.
            </p>
          </BestaetigungErgebnis>
          <NurAblehnen antwort={antwort} />
        </>
      )}

      {/* Pressed, so no decline is offered: the backend refuses every press on a confirmed change. */}
      {stand.zustand === "approval_expired" && (
        <BestaetigungErgebnis
          panelRef={ergebnisRef}
          tone="hinweis">
          <p className={ABSATZ_CLASSES}>
            Die Änderung ist abgelaufen, weil die Verwaltung ihr nicht rechtzeitig zugestimmt hat. Diese Adresse wird nicht übernommen.{" "}
            {stand.way === "account"
              ? "Brauchst Du die Änderung noch, frag sie in Deinem Konto neu an."
              : `Brauchst Du die Änderung noch, schreib uns an ${KONTAKT_EMAIL}.`}
          </p>
          <ZurLiga />
        </BestaetigungErgebnis>
      )}

      {/* Naming no cause, the holder of this mailbox being a stranger to each, and no end: an account's move still owed,
          or entries the league removes, pass, and the confirmation opens again. */}
      {stand.zustand === "not_confirmable" && (
        <>
          <BestaetigungErgebnis
            panelRef={ergebnisRef}
            tone="hinweis">
            <p className={ABSATZ_CLASSES}>
              Diese Änderung der E-Mail-Adresse kann gerade nicht bestätigt werden. Versuche es später erneut, oder schreib uns an{" "}
              {KONTAKT_EMAIL}.
            </p>
          </BestaetigungErgebnis>
          <NurAblehnen antwort={antwort} />
        </>
      )}

      {/* A token matching no change, live or ended: never minted, or ended past the time its record is kept. */}
      {stand.zustand === "invalid" && (
        <BestaetigungErgebnis
          panelRef={ergebnisRef}
          tone="hinweis">
          <p className={ABSATZ_CLASSES}>Zu diesem Link finden wir keine Änderung. Fragen jederzeit per E-Mail an {KONTAKT_EMAIL}.</p>
          <FrageStellen />
        </BestaetigungErgebnis>
      )}

      {stand.zustand === "unlesbar" && <LinkUnlesbar panelRef={ergebnisRef} />}
    </section>
  );
}
