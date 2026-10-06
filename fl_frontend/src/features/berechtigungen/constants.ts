import { benannt } from "@/shared/utils/benannt";

import type { FLVerwaltung } from "./schemas";

/**
 * The most outbox rows one stamp names, mirroring the backend's `LIST_LIMIT_DEFAULT`
 * (`fl_backend/app/shared/schemas/bounds.py`), which also caps what one claim hands out.
 */
export const ANKUENDIGUNGEN_MAX = 1024;

// Its own module: every export of a `"use client"` view becomes a client reference.
export const BERECHTIGUNGEN_CRUD_COPY = {
  // The address and who granted it are what a row carries, so they are what the bar can reach.
  searchLabel: "Zugänge suchen",
  searchPlaceholder: "z.B. name@beispiel.de",
  /** The create trigger's words, which the route's loading placeholder also lays out, so its box is the trigger's own. */
  createLabel: "Zugang erteilen",
  // Two rather than three: the page declares no facet, so `filtered` is reachable by no press.
  emptyForQuery: "Keine Zugänge für diese Suche.",
  emptyOverall: "Es hat noch niemand Zugang zur Verwaltung.",
} as const;

/** The badge on an `owner` grant, which only an owner's tier change on this page gives or takes. */
export const INHABER_LABEL = "Inhaber";

/** A barred address is served withheld, so the row names the state rather than an address it does not have. */
export const GESPERRTE_ADRESSE = "Gesperrte Adresse";

/**
 * An actor as every admin card names one a read may withhold: a barred administrator by that state,
 * their address served as `null` beside a flag (`docs/frontend/spec.md :: I492`).
 */
export function vonOderGesperrt(von: string | null, gesperrt: boolean): string {
  return gesperrt || von === null ? GESPERRTE_ADRESSE : von;
}

/** What the runbook's Playground paste writes as `erteilt_von` (`docs/ops/runbooks.md` §3), which names nobody. */
export const PLAYGROUND_MARKER = "PLAYGROUND";

/** Shown for that marker under „Erteilt von“: the row came from the database, not from an administrator. */
export const DIREKT_IN_DER_DATENBANK = "Direkt in der Datenbank";

/** The eyebrows over a row's two facts. */
export const ERTEILT_VON_LABEL = "Erteilt von";
export const ERTEILT_AM_LABEL = "Erteilt am";

/** What a CLEAN grant answers, beside the form's title only where the two differ. */
export const ZUGANG_ERTEILT = "Zugang erteilt";

/** Why the revoke is closed to an administrator holding no `owner` grant, and the backend's `-005` in the same words. */
export const NUR_INHABER_ENTZIEHT = "Den Zugang entziehen kann nur der Inhaber.";

/** The row a control's name tells apart after its words: the address, or the grant's day where the address is withheld. */
const zugang = (adresse: string | null, erteiltAm: string): string => adresse ?? `Zugang vom ${erteiltAm}`;

/** Each row's revoke: short words on the control, which an address would run past on a phone. */
export function entziehenLabels(adresse: string | null, erteiltAm: string): { resting: string; name: string; armed: string } {
  const resting = "Zugang entziehen";
  return { resting, name: benannt(resting, zugang(adresse, erteiltAm)), armed: "Ja, Zugang endgültig entziehen" };
}

/** What the revoke costs, in its armed state: the person is out at once, and everybody is told. */
export const ZUGANG_ENTZIEHEN_CONSEQUENCE =
  "Die Adresse kann die Verwaltung ab sofort nicht mehr betreten. Alle mit Zugang erhalten eine E-Mail.";

/** What a clean revoke answers, the approved notice's own sentence with the address left out. */
export const ZUGANG_ENTZOGEN_MESSAGE = "Diese Adresse hat keinen Zugang zur Verwaltung mehr.";

/**
 * The grant's refusal of a barred address, which also closes a barred row's promotion: the backend
 * refuses to make a barred address an owner (`REQ-BERECHTIGUNG-003`).
 */
export const ADRESSE_GESPERRT = "Diese Adresse ist gesperrt. Hebe zuerst die Sperre auf, wenn sie Zugang zur Verwaltung erhalten soll.";

/** A barred address already holds its grant here, so the sentence names what it would become. */
export const INHABER_GESPERRT = "Diese Adresse ist gesperrt. Hebe zuerst die Sperre auf, wenn sie Inhaber werden soll.";

/**
 * Each row's tier change in words: the control at rest and armed, its running label, and what the armed state
 * costs. `name` names the row where the words on the control repeat from row to row.
 */
type StufeWorte = { resting: string; name?: string; armed: string; running: string; folge: string };

/**
 * Each row's tier change, named as its revoke is and by the tier it moves to. The administrator's own row
 * is named as theirs: stepping down is theirs alone.
 */
export function stufeWorte({
  adresse,
  erteiltAm,
  ziel,
  eigene,
}: {
  adresse: string | null;
  erteiltAm: string;
  ziel: FLVerwaltung;
  eigene: boolean;
}): StufeWorte {
  const mail = "Alle mit Zugang erhalten eine E-Mail.";
  if (eigene) {
    return {
      resting: "Mich zur Verwaltung herabstufen",
      armed: "Ja, mich zur Verwaltung herabstufen",
      running: "Stuft herab...",
      // Said before the press: nothing on this page makes the administrator an owner again.
      folge: `Du bist dann nicht mehr Inhaber der Verwaltung und behältst den Zugang. Inhaber wirst Du nur wieder, wenn Dich ein anderer Inhaber ernennt. ${mail}`,
    };
  }

  const wer = adresse ?? `Wer den Zugang vom ${erteiltAm} hat,`;
  return ziel === "owner"
    ? {
        resting: "Zum Inhaber ernennen",
        name: benannt("Zum Inhaber ernennen", zugang(adresse, erteiltAm)),
        armed: "Ja, zum Inhaber ernennen",
        running: "Ernennt...",
        // What an owner can do that an administrator cannot, the acting owner's own tier included.
        folge: `${wer} wird Inhaber der Verwaltung und kann dann Zugänge entziehen und jede Stufe ändern, auch Deine. ${mail}`,
      }
    : {
        resting: "Zur Verwaltung herabstufen",
        name: benannt("Zur Verwaltung herabstufen", zugang(adresse, erteiltAm)),
        armed: "Ja, zur Verwaltung herabstufen",
        running: "Stuft herab...",
        folge: `${wer} ist dann nicht mehr Inhaber der Verwaltung und behält den Zugang. ${mail}`,
      };
}

/** What a tier change answers, done or already so, the notice's sentence for the tier with the address left out. */
export const STUFE_GEAENDERT_MESSAGE: Readonly<Record<FLVerwaltung, string>> = {
  owner: "Diese Adresse ist jetzt Inhaber der Verwaltung.",
  administration: "Diese Adresse ist nicht mehr Inhaber der Verwaltung und behält den Zugang.",
};

/** Rows the backend left out as no request can match them: a database paste to repair, never one this page can make. */
export const uebersprungenHinweis = (anzahl: number): string =>
  anzahl === 1
    ? "Ein Eintrag in der Datenbank passt zu keiner Adresse und gewährt keinen Zugang."
    : `${String(anzahl)} Einträge in der Datenbank passen zu keiner Adresse und gewähren keinen Zugang.`;
