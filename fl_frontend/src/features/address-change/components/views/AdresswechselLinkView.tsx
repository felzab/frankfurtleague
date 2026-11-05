"use client";

import { useState, useTransition } from "react";

import CircleCheck from "@gravity-ui/icons/CircleCheck";

import { Button } from "@heroui/react/button";

import { ADDRESS_CHANGE_VALID_HOURS, ADDRESS_CHANGE_WAIT_SPAN } from "@/core/addressChange";
import { ADDRESS_CHANGE_STOP } from "@/core/addressChangeAnswers";
import { KONTAKT_EMAIL } from "@/core/brand";
import { formatInstant } from "@/core/format";
import { startOf } from "@/features/address-change/link";
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
import { formButton } from "@/shared/components/ui/formButtons";
import { appToast } from "@/shared/utils/appToast";
import { ANTWORT_UNKLAR, UNKLAR_TITEL } from "@/shared/utils/publicSubmit";

import type { ActionAnswer } from "@/core/action";
import type { FLAddressChangeEndKind, FLAddressChangeWay } from "@/core/generated/client/types";
import type {
  AddressChangeLinkState,
  AddressChangePressed,
  AddressChangeStart,
  AddressChangeView,
  OldViewPreviousState,
} from "@/features/address-change/link";

type Antwort = AddressChangePressed["answer"];

type Beendet = Extract<AddressChangeView, { state: "ended" }>;

/**
 * What a press of this view comes to, as `app/(classic)/confirm/address/answers.ts :: verwaltungswegBeantworten`
 * answers it: the press landed, the link stands in a state that refuses it, or the change moved since the page opened,
 * which the link's own read says, null where that read failed.
 */
export type AdresswechselPresse =
  { gedrueckt: Omit<AddressChangePressed, "success"> } | { zustand: AddressChangeLinkState } | { ansicht: AddressChangeView | null };

/** The action every press of this view sends through, with the link's token. */
type Beantworten = (presse: { token: string; antwort: Antwort }) => Promise<ActionAnswer<AdresswechselPresse>>;

/**
 * The new mailbox's confirmation, asking about the change and never about the mailbox: the holder of an address the league
 * already writes to owns it truthfully, and would hand a stranger's records over by agreeing to that.
 */
const JA_ANGEFRAGT = "Ja, ich habe diese Änderung angefragt";

const NICHT_MEINE_ADRESSE = "Das ist nicht meine Adresse";

const STOPP_TITEL = "Änderung Deiner E-Mail-Adresse";

/** One heading per live state. A barred link's page has none; an ended change's heading is its side's and its end's. */
const TITEL: Record<Exclude<AddressChangeStart["state"], "barred" | "ended">, string> = {
  valid: "Neue E-Mail-Adresse bestätigen",
  confirmed: "Adresse bestätigt",
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
const ENDE: Record<FLAddressChangeEndKind, Record<Beendet["side"], { titel: string; satz: string }>> = {
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
 * A tombstone names no way, so this holds for each: the account follows where the address on file asked for the
 * change, and never after a lost mailbox, whose holder may be a stranger.
 */
const PASSKEY_SATZ =
  "Klappt die Anmeldung mit Deinem bisherigen Passkey nicht, melde Dich mit einem Code an die neue Adresse an und richte in Deinem Konto einen neuen ein.";

/** What the new mailbox's holder does once the change takes effect, told before it does. */
const DANACH: Readonly<Record<FLAddressChangeWay, string>> = {
  // Never "Deine Passkeys gelten weiter": a sign-in account already standing at the new address keeps them behind, and no
  // served field tells this page so.
  account: `Bis dahin meldest Du Dich mit der bisherigen an. Danach meldest Du Dich überall neu an. ${PASSKEY_SATZ}`,
  waiting_period:
    "Bis dahin gilt die bisherige Adresse. Danach meldest Du Dich mit einem Code an die neue an. Passkeys der bisherigen gelten dann nicht mehr: Richte in Deinem Konto einen neuen ein.",
};

/** The state a press's answer leaves the page in, the side being the press's own. */
function nachDruck(antwort: AddressChangePressed, way: FLAddressChangeWay): AddressChangeStart {
  if (antwort.answer === "declined") return { state: "ended", side: "new", art: "declined" };
  if (antwort.answer === "stopped") return { state: "ended", side: "previous", art: "stopped" };
  if (antwort.effective) return { state: "ended", side: "new", art: "effective" };

  return { state: "confirmed", wirksamAb: antwort.effective_from, genehmigungOffen: antwort.approval_open, way: way };
}

/** Sends one answer through the link and hands its outcome to the page: a result, or the state a refused press leaves the link in. */
function useAntwort(start: AddressChangeStart, beantworten: Beantworten, onAbschluss: (stand: AddressChangeStart) => void) {
  const [isPending, startSending] = useTransition();
  const [gedrueckt, setGedrueckt] = useState<Antwort | null>(null);
  // Only a state holding a token renders a press, and each of those names its way.
  const link = "token" in start ? start : null;

  const sende = (antwort: Antwort) => {
    if (link === null) return;
    const { token, way } = link;
    setGedrueckt(antwort);
    startSending(async () => {
      // A press that threw may have landed, so it is told apart from the builder's own refusal.
      const answer = await beantworten({ token: token, antwort: antwort }).catch(() => null);

      // Wrapped again: React leaves an update after an `await` outside the transition.
      startSending(() => {
        if (answer === null) {
          appToast.danger(UNKLAR_TITEL, { description: ANTWORT_UNKLAR });
          return;
        }
        if (!answer.ok) {
          appToast.danger(ANTWORT_NICHT_GESPEICHERT, { description: answer.reason ?? ANTWORT_NICHT_GESPEICHERT_SATZ });
          return;
        }
        const presse = answer.value;
        if ("gedrueckt" in presse) {
          onAbschluss(nachDruck({ success: true, ...presse.gedrueckt }, way));
          return;
        }
        // The change moved between the open and the press: the answer is the panel, never a toast.
        if ("ansicht" in presse) {
          onAbschluss(presse.ansicht === null ? { state: "unlesbar" } : startOf(presse.ansicht, token));
          return;
        }
        const { zustand } = presse;
        // The decline stays open on these two, so their panel keeps the token.
        onAbschluss(zustand === "expired" || zustand === "not_confirmable" ? { state: zustand, way: way, token } : { state: zustand });
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

function AntwortPanel({ gueltigBis, way, antwort }: { gueltigBis: string; way: FLAddressChangeWay; antwort: Presse }) {
  const { sende, isPending, gedrueckt } = antwort;

  return (
    <BestaetigungAbschnitt titel="Deine Adresse">
      {/* Naming nobody and no record: whoever holds the link has proved no mailbox yet, and the change moves
          every record the address holds. */}
      <p className={ABSATZ_CLASSES}>
        Für ein Konto bei der Frankfurt League soll künftig diese E-Mail-Adresse gelten. Bestätigst Du sie, schreiben wir Dir hierhin, und Du
        meldest Dich mit ihr an.
        {way === "waiting_period" && ` Sie gilt ${ADDRESS_CHANGE_WAIT_SPAN} nach Deiner Bestätigung.`}
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
function stoppSatz(zustand: OldViewPreviousState, way: FLAddressChangeWay, wirksamAb: string | null) {
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
    return `Die Verwaltung hat eine neue E-Mail-Adresse für Dein Konto eingetragen, weil diese nicht mehr erreichbar sein soll. Bestätigt die neue Adresse ihren Link, gilt sie ${ADDRESS_CHANGE_WAIT_SPAN} danach. Hast Du das nicht angefragt, stoppe die Änderung. Dann bleibt diese Adresse.`;
  }
  return "Für Dein Konto soll eine neue E-Mail-Adresse gelten, sobald sie bestätigt ist. Hast Du das nicht selbst angefragt, stoppe die Änderung. Dann bleibt diese Adresse.";
}

/**
 * The stop link of the address on file, in every state the change can stand in: a stop hands nothing
 * over, so it is offered as the decline is. The approval is never here, needing a fresh sign-in.
 */
function StoppPanel({
  zustand,
  way,
  wirksamAb,
  antwort,
}: {
  zustand: OldViewPreviousState;
  way: FLAddressChangeWay;
  wirksamAb: string | null;
  antwort: Presse;
}) {
  const { sende, isPending } = antwort;

  return (
    <BestaetigungAbschnitt titel="Deine Adresse">
      <p className={ABSATZ_CLASSES}>{stoppSatz(zustand, way, wirksamAb)}</p>
      <div className={AKTIONEN_CLASSES}>
        <Button
          type="button"
          isPending={isPending}
          onPress={() => sende("stopped")}
          className={formButton({ intent: "destructive", stacks: true })}>
          {ADDRESS_CHANGE_STOP}
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

/**
 * Session 7: the administrator's way, in every state either link of such a change can be in, live or awaiting
 * an approval; the person's own way, ended changes included, is `kit/MailedPage.tsx`'s. A grant holder's own change
 * confirmed and waiting on its approval stands here too, the approval being the administrators' page's.
 */
export function AdresswechselLinkView({ start, beantworten }: { start: AddressChangeStart; beantworten: Beantworten }) {
  const [stand, setStand] = useState<AddressChangeStart>(start);
  const { ergebnisRef, beantwortet } = useLinkSeite(stand.state);
  const onAbschluss = (naechster: AddressChangeStart) => {
    beantwortet();
    setStand(naechster);
  };
  // Every state holding a token sends through it; a state without one renders no press.
  const antwort = useAntwort(stand, beantworten, onAbschluss);

  if (stand.state === "barred") return <AdresseGesperrt panelRef={ergebnisRef} />;

  const titel = stand.state === "ended" ? ENDE[stand.art][stand.side].titel : TITEL[stand.state];

  return (
    <section className={SEITE_CLASSES}>
      <header className="flex w-full flex-col gap-3">
        <h1 className={`${DISPLAY_HEADING_CLASSES} fluid-3xl`}>{titel}</h1>
      </header>

      {stand.state === "valid" && (
        <AntwortPanel
          gueltigBis={stand.gueltigBis}
          way={stand.way}
          antwort={antwort}
        />
      )}

      {(stand.state === "open" || stand.state === "approval" || stand.state === "waiting_period") && (
        <StoppPanel
          zustand={stand.state}
          way={stand.way}
          wirksamAb={stand.wirksamAb}
          antwort={antwort}
        />
      )}

      {stand.state === "confirmed" && (
        <BestaetigungErgebnis
          panelRef={ergebnisRef}
          tone="erfolg">
          <p className={ABSATZ_CLASSES}>{bestaetigtSatz(stand)}</p>
          {/* A lost mailbox's holder is never sent back to it to sign in, and keeps no passkey of it. */}
          <p className={ABSATZ_CLASSES}>{DANACH[stand.way]}</p>
          <ZurLiga />
        </BestaetigungErgebnis>
      )}

      {stand.state === "ended" && (
        <BestaetigungErgebnis
          panelRef={ergebnisRef}
          tone={stand.art === "effective" && stand.side === "previous" ? "hinweis" : "erfolg"}>
          <p className={ABSATZ_CLASSES}>{ENDE[stand.art][stand.side].satz}</p>
          {stand.art === "effective" && stand.side === "new" && <p className={ABSATZ_CLASSES}>{PASSKEY_SATZ}</p>}
          <ZurLiga />
        </BestaetigungErgebnis>
      )}

      {/* Told apart from the dead link: the backend serves a lapsed change as lapsed, and only a link it still holds can be. */}
      {stand.state === "expired" && (
        <>
          <BestaetigungErgebnis
            panelRef={ergebnisRef}
            tone="hinweis">
            <p className={ABSATZ_CLASSES}>
              Dieser Link ist abgelaufen. Ein Link gilt {String(ADDRESS_CHANGE_VALID_HOURS)} Stunden.{" "}
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
      {stand.state === "approval_expired" && (
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
      {stand.state === "not_confirmable" && (
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
      {stand.state === "invalid" && (
        <BestaetigungErgebnis
          panelRef={ergebnisRef}
          tone="hinweis">
          <p className={ABSATZ_CLASSES}>Zu diesem Link finden wir keine Änderung. Fragen jederzeit per E-Mail an {KONTAKT_EMAIL}.</p>
          <FrageStellen />
        </BestaetigungErgebnis>
      )}

      {stand.state === "unlesbar" && <LinkUnlesbar panelRef={ergebnisRef} />}
    </section>
  );
}
