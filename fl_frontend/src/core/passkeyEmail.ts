import "server-only";

import { mailOrigin } from "./emailShell";
import { formatInstant } from "./format";

import type { Mail, Sentence } from "./emailShell";

/** The subject and the sentence of one event; nothing here names a row or a device. */
interface Ereignis {
  readonly betreff: string;
  readonly saetze: (zeit: string) => readonly [Sentence, ...Sentence[]];
}

const HINZUGEFUEGT: Ereignis = {
  betreff: "Neuer Passkey für Dein Konto",
  saetze: (zeit) => [["Deinem Konto wurde am ", { strong: zeit }, " ein Passkey hinzugefügt."]],
};

const GELOESCHT: Ereignis = {
  betreff: "Passkey für Dein Konto gelöscht",
  // Only the devices that passkey signed in: a removal ends the sessions carrying its credential and
  // leaves every other standing (`fl_frontend/src/core/auth.ts :: removePasskey`).
  saetze: (zeit) => [
    ["Von Deinem Konto wurde am ", { strong: zeit }, " ein Passkey gelöscht."],
    "Geräte, die damit angemeldet waren, wurden abgemeldet.",
  ],
};

/** What a builder is handed; `konto` is a path on `origin`, one area's account page (`fl_frontend/src/core/kontoHref.ts`). */
type Anlass = { zeitpunkt: Date; origin: string; konto: string };

function build(ereignis: Ereignis, { zeitpunkt, origin, konto }: Anlass): Mail {
  const site = mailOrigin(origin);

  return {
    art: "sicherheit",
    subjectLine: ereignis.betreff,
    origin: site,
    vorname: "",
    paragraphs: [ereignis.saetze(formatInstant(zeitpunkt))],
    // The reader's own account page, which is the only place either event can be acted on.
    button: { label: "Zu Deinem Konto", href: `${site}${konto}` },
  };
}

export function buildPasskeyHinzugefuegtEmail(anlass: Anlass): Mail {
  return build(HINZUGEFUEGT, anlass);
}

export function buildPasskeyGeloeschtEmail(anlass: Anlass): Mail {
  return build(GELOESCHT, anlass);
}
