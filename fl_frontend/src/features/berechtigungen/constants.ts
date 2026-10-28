import { ERASED_ACTOR_MARKER } from "@/core/erasedActor";
import { OFFENE_ANTRAEGE } from "@/core/seitenNamen";
import { benannt } from "@/shared/utils/benannt";

import type { FLGenehmigungVerwehrt, FLVerwaltung } from "./schemas";

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

/**
 * The badge on an `owner` grant, which only an owner's tier change gives or takes. Both genders, as every sentence
 * names the tier: a shorter badge word would be its second name.
 */
export const INHABER_LABEL = "Inhaberin oder Inhaber";

/** A barred address is served withheld, so the row names the state rather than an address it does not have. */
export const GESPERRTE_ADRESSE = "Gesperrte Adresse";

/** An erased person in an actor's place, which the backend serves as a marker naming nobody. */
export const GELOESCHTE_PERSON = "Gelöschte Person";

/**
 * An actor as every admin card names one a read may withhold: a barred administrator by that state,
 * their address served as `null` beside a flag, and an erased person by theirs (`docs/frontend/spec.md :: I492`).
 */
export function vonOderGesperrt(von: string | null, gesperrt: boolean): string {
  if (gesperrt || von === null) return GESPERRTE_ADRESSE;

  return von === ERASED_ACTOR_MARKER ? GELOESCHTE_PERSON : von;
}

/**
 * `vonOderGesperrt` after „von“, where a withheld actor takes the dative: „von Gesperrte Adresse“ reads as a typing
 * error. The words are the grant notice's (`fl_frontend/src/core/berechtigungEmail.ts :: urheberName`).
 */
export function nachVonOderGesperrt(von: string | null, gesperrt: boolean): string {
  if (gesperrt || von === null) return "einer gesperrten Adresse";

  return von === ERASED_ACTOR_MARKER ? "einer nicht genannten Adresse" : von;
}

/** What the runbook's Playground paste writes as `erteilt_von` (`docs/ops/runbooks.md` §3), which names nobody. */
const PLAYGROUND_MARKER = "PLAYGROUND";

/** Shown for that marker under „Erteilt von“: the row came from the database, not from an administrator. */
export const DIREKT_IN_DER_DATENBANK = "Direkt in der Datenbank";

/**
 * A grant's „Erteilt von“ as its card prints it, which the grants list's search reads too: a search
 * over the stored value finds the marker nobody sees (`docs/frontend/spec.md :: I681`).
 */
export function erteiltVonAnzeige(von: string | null, gesperrt: boolean): string {
  const angezeigt = vonOderGesperrt(von, gesperrt);

  return angezeigt === PLAYGROUND_MARKER || angezeigt === "" ? DIREKT_IN_DER_DATENBANK : angezeigt;
}

/** The eyebrows over a row's two facts. */
export const ERTEILT_VON_LABEL = "Erteilt von";
export const ERTEILT_AM_LABEL = "Erteilt am";

/** What a CLEAN grant answers, beside the form's title only where the two differ. */
export const ZUGANG_ERTEILT = "Zugang erteilt";

/**
 * Closes every refusal of an owner's power. A promotion holds for a sign-in after it alone (`docs/backend/spec.md :: I534`),
 * so an owner signed in before it is refused too, and would read the refusal as false of them.
 */
export const NACH_ERNENNUNG_NEU_ANMELDEN = "Bist Du erst nach Deiner Anmeldung Inhaberin oder Inhaber geworden, melde Dich neu an.";

/**
 * Who decides about a promotion, closing every sentence that names who decides about a request: another
 * administrator decides a grant, another owner alone a promotion (`docs/backend/spec.md :: I848`).
 */
const ERNENNUNG_GENEHMIGT = "eine Ernennung eine andere Inhaberin oder ein anderer Inhaber";

/** Why the revoke is closed to a session holding no owner's power, and the backend's `-005` in the same words. */
export const NUR_INHABER_ENTZIEHT = `Den Zugang entziehen können nur Inhaberinnen und Inhaber. ${NACH_ERNENNUNG_NEU_ANMELDEN}`;

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
export const INHABER_GESPERRT = "Diese Adresse ist gesperrt. Hebe zuerst die Sperre auf, wenn sie Inhaberin oder Inhaber werden soll.";

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
      folge: `Du bist dann nicht mehr Inhaberin oder Inhaber der Verwaltung und behältst den Zugang. Wieder ernennen kann Dich nur, wer Inhaberin oder Inhaber ist. ${mail}`,
    };
  }

  const wer = adresse ?? `Wer den Zugang vom ${erteiltAm} hat,`;
  return ziel === "owner"
    ? {
        resting: "Zur Inhaberin oder zum Inhaber ernennen",
        name: benannt("Zur Inhaberin oder zum Inhaber ernennen", zugang(adresse, erteiltAm)),
        armed: "Ja, zur Inhaberin oder zum Inhaber ernennen",
        running: "Ernennt...",
        // What an owner can do that an administrator cannot, the acting owner's own tier included.
        folge: `${wer} wird Inhaberin oder Inhaber der Verwaltung und kann dann Zugänge entziehen und jede Stufe ändern, auch Deine. ${mail}`,
      }
    : {
        resting: "Zur Verwaltung herabstufen",
        name: benannt("Zur Verwaltung herabstufen", zugang(adresse, erteiltAm)),
        armed: "Ja, zur Verwaltung herabstufen",
        running: "Stuft herab...",
        folge: `${wer} ist dann nicht mehr Inhaberin oder Inhaber der Verwaltung und behält den Zugang. ${mail}`,
      };
}

/** What a tier change answers, done or already so, the notice's sentence for the tier with the address left out. */
export const STUFE_GEAENDERT_MESSAGE: Readonly<Record<FLVerwaltung, string>> = {
  owner: "Diese Adresse ist jetzt Inhaberin oder Inhaber der Verwaltung.",
  administration: "Diese Adresse ist nicht mehr Inhaberin oder Inhaber der Verwaltung und behält den Zugang.",
};

/** Rows the backend left out as no request can match them: a database paste to repair, never one this page can make. */
export const uebersprungenHinweis = (anzahl: number): string =>
  anzahl === 1
    ? "Ein Eintrag in der Datenbank passt zu keiner Adresse und gewährt keinen Zugang."
    : `${String(anzahl)} Einträge in der Datenbank passen zu keiner Adresse und gewähren keinen Zugang.`;

/** What a request asks for, by the tier it names: `owner` is a promotion of a grant that stands. */
export const ANTRAG_WAS: Readonly<Record<FLVerwaltung, string>> = {
  administration: "Zugang zur Verwaltung",
  owner: "Ernennung zur Inhaberin oder zum Inhaber",
};

/** The eyebrows over a request's four facts. */
export const BEANTRAGT_LABEL = "Beantragt";
export const GESTELLT_VON_LABEL = "Gestellt von";
export const GESTELLT_AM_LABEL = "Gestellt am";
export const OFFEN_BIS_LABEL = "Offen bis";

/** The heading over the grants while the requests' section stands above them, which would otherwise seem to head them too. */
export const ALLE_ZUGAENGE = "Alle Zugänge";

/** A second request about an address one already waits for: the way out is deciding that one, so the sentence says where it is. */
export const ANTRAG_OFFEN = `Für diese Adresse wartet schon ein Antrag. Du findest ihn unter „${OFFENE_ANTRAEGE}“.`;

/** A grant another administrator could approve is asked for rather than made, so the create says so in its title. */
export const ZUGANG_BEANTRAGT = "Zugang beantragt";
export const ZUGANG_BEANTRAGT_MESSAGE = `Eine andere Person aus der Verwaltung muss den Zugang genehmigen, bevor er gilt. Bis dahin steht er unter „${OFFENE_ANTRAEGE}“.`;
export const ERNENNUNG_BEANTRAGT = "Ernennung beantragt";
export const ERNENNUNG_BEANTRAGT_MESSAGE = `Eine andere Inhaberin oder ein anderer Inhaber muss die Ernennung genehmigen, bevor sie gilt. Bis dahin steht sie unter „${OFFENE_ANTRAEGE}“.`;

/**
 * Why this administrator may not decide a request, in the backend's refusals' own words, so the closed press and
 * the refused one say it alike. The requester's own (`gestartet`) closes the approval alone: they withdraw it.
 */
export const ANTRAG_ENTSCHEIDEN_VERWEHRT: Readonly<Record<Exclude<FLGenehmigungVerwehrt, "gestartet">, string>> = {
  eigene: `Über einen Antrag, der Dich betrifft, entscheidet eine andere Person aus der Verwaltung, über ${ERNENNUNG_GENEHMIGT}.`,
  inhaber: `Über eine Ernennung zur Inhaberin oder zum Inhaber entscheidet nur eine andere Inhaberin oder ein anderer Inhaber. ${NACH_ERNENNUNG_NEU_ANMELDEN}`,
  juenger:
    "Entscheiden kann nur, wer schon vor dem Antrag Zugang zur Verwaltung hatte, über eine Ernennung nur, wer schon vorher Inhaberin oder Inhaber war.",
};

/** The requester's own request, which they withdraw rather than approve. */
export const EIGENER_ANTRAG = `Einen Antrag, den Du gestellt hast, genehmigt eine andere Person aus der Verwaltung, ${ERNENNUNG_GENEHMIGT}. Zurückziehen kannst Du ihn.`;

/** The approval's refusal of its own requester or subject, the backend's one code naming either. */
export const ANTRAG_EIGENE_ODER_GESTELLT = `Einen Antrag, den Du gestellt hast oder der Dich betrifft, genehmigt eine andere Person aus der Verwaltung, ${ERNENNUNG_GENEHMIGT}.`;

/** A request whose requester has lost, since asking, the tier it asks for: nobody approves it, and a refusal clears the address. */
export const ANTRAG_VERFALLEN =
  "Wer den Antrag gestellt hat, hat diesen Zugang inzwischen nicht mehr, deshalb genehmigt ihn niemand. Lehne ihn ab und stelle ihn bei Bedarf neu.";

/** What an approval answers: its change is announced as one made directly is. */
export const ANTRAG_GENEHMIGT_MESSAGE = "Der Antrag ist genehmigt. Alle mit Zugang erhalten eine E-Mail.";

/** What a refusal or a withdrawal answers: nothing it asked for happened. */
export const ANTRAG_GELOESCHT_MESSAGE = "Der Antrag ist gelöscht. Am Zugang ändert sich nichts.";
