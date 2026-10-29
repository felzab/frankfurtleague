import "server-only";

import { mailOrigin } from "./emailShell";
import { ERASED_ACTOR_MARKER } from "./erasedActor";
import { formatZeitpunkt } from "./format";
import { OFFENE_ANTRAEGE } from "./seitenNamen";

import type { Lauf, Mail } from "./emailShell";

const BETREFF = "Änderung beim Zugang zur Verwaltung";
const ZIEL_LABEL = "Zur Verwaltung";

const ZIEL_PFAD = "/bereich/admin/administratoren";

/** A change made outside the application names nobody, and says where it was made instead. */
const OHNE_VERWALTUNG = "Diese Änderung wurde nicht in der Verwaltung vorgenommen, sondern direkt in der Datenbank.";

/** What a reader does with the notice, and the whole of why every holder is sent it. */
const WARNSATZ = "Wenn Du diese Änderung nicht erwartet hast, melde Dich sofort bei den anderen Administratorinnen und Administratoren.";

/**
 * A request's own subject and closing, by what it asks: it changes nobody's access and asks its reader to
 * decide it, and a promotion's subject already holds the access a grant's asks for.
 */
const ANTRAG: Readonly<Record<"zugang" | "ernennung", { betreff: string; aufgabe: readonly [string, string] }>> = {
  zugang: {
    betreff: "Antrag auf Zugang zur Verwaltung",
    aufgabe: [
      `Genehmige oder lehne den Antrag in der Verwaltung unter „${OFFENE_ANTRAEGE}“ ab.`,
      "Genehmige ihn nur, wenn Du sicher bist, dass die Person diesen Zugang bekommen soll.",
    ],
  },
  ernennung: {
    betreff: "Antrag auf Ernennung in der Verwaltung",
    aufgabe: [
      `Genehmige oder lehne den Antrag in der Verwaltung unter „${OFFENE_ANTRAEGE}“ ab.`,
      "Genehmige ihn nur, wenn Du sicher bist, dass die Person Inhaberin oder Inhaber werden soll.",
    ],
  },
};

/** Why a grant's address is withheld, the notice naming neither a barred address nor an erased person's. */
export type Vorenthalten = { readonly vorenthalten: "gesperrt" | "geloescht" };

/** One change as the notice states it. */
export type Zugangsaenderung = {
  // `beantragt`: a grant or a promotion asked for, sent to whoever could approve it.
  readonly art: "erteilt" | "geaendert" | "entzogen" | "beantragt";
  readonly adresse: string | Vorenthalten;
  // The `owner` tier the grant holds now, or held until it ended.
  readonly inhaber: boolean;
};

/**
 * Who made the change and when, or `null` where it was made in the database directly. `von` is null for an
 * administrator since barred, and `ERASED_ACTOR_MARKER` for one erased since, neither of whom the notice names.
 */
export type Urheber = { readonly von: string | null; readonly am: string | null } | null;

/** A withheld grant address, in the subject's place. An erased person's is named by nothing, not even that state. */
const OHNE_ADRESSE: Readonly<Record<Vorenthalten["vorenthalten"], string>> = {
  gesperrt: "Eine gesperrte Adresse",
  geloescht: "Eine nicht genannte Adresse",
};

/** A withheld address inside a sentence rather than opening it, read off the same words. */
function ohneAdresseImSatz(vorenthalten: Vorenthalten["vorenthalten"]): string {
  const wort = OHNE_ADRESSE[vorenthalten];

  return `${wort.charAt(0).toLowerCase()}${wort.slice(1)}`;
}

/** The `owner` tier as a person of either gender holds it, never the masculine word for both. */
const INHABER = "Inhaberin oder Inhaber";

/** The acting administrator where a ban withholds them. */
const GESPERRTER_URHEBER = "einer gesperrten Adresse";

/** The acting administrator where they have been erased since. */
const UNGENANNTER_URHEBER = "einer nicht genannten Adresse";

/** The change's sentence, a named address set in the emphasis grade. */
function aenderungsSatz({ art, adresse, inhaber }: Zugangsaenderung): readonly Lauf[] {
  const subjekt: Lauf = typeof adresse === "string" ? { stark: adresse } : OHNE_ADRESSE[adresse.vorenthalten];

  switch (art) {
    case "erteilt":
      // An `owner` grant says so: the application writes one only as an owner's address change moves it, the
      // rest coming from the database, and an owner's grant is the one a holder most needs told.
      return [subjekt, inhaber ? ` hat jetzt Zugang zur Verwaltung als ${INHABER}.` : " hat jetzt Zugang zur Verwaltung."];
    case "entzogen":
      // An `owner` grant's end says so: an erasure ends one with no demotion before it, and the last owner's
      // end is the one a holder most needs told.
      return [
        subjekt,
        inhaber ? ` ist nicht mehr ${INHABER} der Verwaltung und hat keinen Zugang mehr.` : " hat keinen Zugang zur Verwaltung mehr.",
      ];
    case "geaendert":
      return [subjekt, inhaber ? ` ist jetzt ${INHABER} der Verwaltung.` : ` ist nicht mehr ${INHABER} der Verwaltung und behält den Zugang.`];
    case "beantragt":
      return inhaber
        ? ["Für ", subjekt, ` ist beantragt, ${INHABER} der Verwaltung zu werden.`]
        : ["Für ", subjekt, " ist ein Zugang zur Verwaltung beantragt."];
  }
}

/** The acting administrator in the notice's words, never a barred address or the erasure's marker. */
function urheberName(von: string | null): string {
  if (von === null) return GESPERRTER_URHEBER;

  return von === ERASED_ACTOR_MARKER ? UNGENANNTER_URHEBER : von;
}

/** The second sentence: who made it and when, or where a change nobody in the application made came from. */
function urheberSatz(urheber: Urheber, verb: string): string {
  if (urheber === null) return OHNE_VERWALTUNG;

  const von = urheberName(urheber.von);
  return urheber.am === null ? `${verb} von ${von}.` : `${verb} von ${von} am ${formatZeitpunkt(urheber.am)}.`;
}

/** How a request ended, told to its requester alone. */
export type AntragEnde = {
  readonly art: "antrag_abgelehnt" | "antrag_beendet";
  // The address the request was for, or why it is withheld.
  readonly adresse: string | Vorenthalten;
  // Whether it asked for an owner's promotion rather than access.
  readonly inhaber: boolean;
};

/** The request as its requester asked it, a named address set in the emphasis grade. */
function antragSatz({ art, adresse, inhaber }: AntragEnde): readonly Lauf[] {
  const fuer: Lauf = typeof adresse === "string" ? { stark: adresse } : ohneAdresseImSatz(adresse.vorenthalten);
  const antrag: readonly Lauf[] = inhaber
    ? ["Dein Antrag, ", fuer, " zur Inhaberin oder zum Inhaber der Verwaltung zu ernennen,"]
    : ["Dein Antrag auf Zugang zur Verwaltung für ", fuer];

  return [...antrag, art === "antrag_abgelehnt" ? " wurde abgelehnt." : " endete, weil sich die Adresse geändert hat."];
}

/**
 * A request's end, mailed to the administrator who asked for it under the request's own subject. It names the address they
 * asked about, which they typed, and nobody who acted: never who refused it.
 */
export function buildAntragEndeEmail(ende: AntragEnde, rawOrigin: string): Mail {
  const origin = mailOrigin(rawOrigin);

  return {
    art: "mitteilung",
    betreff: ANTRAG[ende.inhaber ? "ernennung" : "zugang"].betreff,
    origin: origin,
    vorname: "",
    absaetze: [[antragSatz(ende)]],
    aktion: { label: ZIEL_LABEL, href: `${origin}${ZIEL_PFAD}` },
  };
}

/**
 * **The body depends on the change alone**, never on when it is sent or to whom: a repeat under one key
 * must compose the same message for the provider to collapse it.
 */
export function buildBerechtigungEmail(aenderung: Zugangsaenderung, urheber: Urheber, rawOrigin: string): Mail {
  const origin = mailOrigin(rawOrigin);
  // A request is asked of its reader rather than told to them, so it is headed, signed and closed as one.
  const antrag = aenderung.art === "beantragt" ? ANTRAG[aenderung.inhaber ? "ernennung" : "zugang"] : null;

  return {
    art: "mitteilung",
    betreff: antrag?.betreff ?? BETREFF,
    origin: origin,
    vorname: "",
    absaetze: [[aenderungsSatz(aenderung)], [urheberSatz(urheber, antrag === null ? "Geändert" : "Beantragt")], antrag?.aufgabe ?? [WARNSATZ]],
    aktion: { label: ZIEL_LABEL, href: `${origin}${ZIEL_PFAD}` },
  };
}
