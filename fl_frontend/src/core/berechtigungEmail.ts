import "server-only";

import { mailOrigin } from "./emailShell";
import { formatZeitpunkt } from "./format";
import { GELOESCHT_ACTOR_MARKER } from "./geloeschtActor";
import { OFFENE_ANTRAEGE } from "./seitenNamen";

import type { Lauf, Mail } from "./emailShell";
import type { FLBerechtigungDaten, FLBerechtigungStand } from "./generated/client/types";
import type { MailOrt } from "./mailKinds";

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
type Vorenthalten = { readonly vorenthalten: "gesperrt" | "geloescht" };

/** One change as the notice states it. */
type Zugangsaenderung = {
  // `beantragt`: a grant or a promotion asked for, sent to whoever could approve it.
  readonly art: "erteilt" | "geaendert" | "entzogen" | "beantragt";
  readonly adresse: string | Vorenthalten;
  // The `owner` tier the grant holds now, or held until it ended.
  readonly inhaber: boolean;
};

/**
 * Who made the change and when, or `null` where it was made in the database directly. `von` is null for an
 * administrator since barred, and `GELOESCHT_ACTOR_MARKER` for one erased since, neither of whom the notice names.
 */
type Urheber = { readonly von: string | null; readonly am: string | null } | null;

/** A withheld grant address, in the subject's place. An erased person's is named by nothing, not even that state. */
const OHNE_ADRESSE: Readonly<Record<Vorenthalten["vorenthalten"], string>> = {
  gesperrt: "Eine gesperrte Adresse",
  geloescht: "Eine nicht genannte Adresse",
};

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

/**
 * The acting administrator in the notice's words, never a barred address or the erasure's marker: a named address in
 * the emphasis grade, as the change's own subject is, a withheld one plain.
 */
function urheberName(von: string | null): Lauf {
  if (von === null) return GESPERRTER_URHEBER;

  return von === GELOESCHT_ACTOR_MARKER ? UNGENANNTER_URHEBER : { stark: von };
}

/** The second sentence: who made it and when, or where a change nobody in the application made came from. */
function urheberSatz(urheber: Urheber, verb: string): readonly Lauf[] {
  if (urheber === null) return [OHNE_VERWALTUNG];

  return [`${verb} von `, urheberName(urheber.von), urheber.am === null ? "." : ` am ${formatZeitpunkt(urheber.am)}.`];
}

/** A grant's address as the notice names it, or why it is withheld: a barred one, or an erased person's. */
function adresseOf(daten: FLBerechtigungDaten, stand: FLBerechtigungStand | null): string | Vorenthalten {
  return stand?.adresse ?? { vorenthalten: daten.vorenthalten ?? "gesperrt" };
}

/**
 * A change as the notice words it. An address repointed under one id reaches here as two changes, its
 * removal and the new address's grant, so a `geaendert` is a change of tier alone.
 */
function zugangsaenderungOf(daten: FLBerechtigungDaten): Zugangsaenderung {
  const stand = daten.aenderung === "entzogen" ? daten.vorher : daten.jetzt;

  return { art: daten.aenderung, adresse: adresseOf(daten, stand), inhaber: stand?.verwaltung === "owner" };
}

/** Read off `urheber`, never off a null actor: an application's change whose actor is withheld is a barred one's. */
function urheberOf(daten: FLBerechtigungDaten): Urheber {
  if (daten.urheber === "datenbank") return null;

  return { von: daten.geaendert_von, am: daten.geaendert_am };
}

/** **The body depends on the change alone**, never on when it is sent or to whom: every holder is owed the same notice. */
export function buildBerechtigungEmail(daten: FLBerechtigungDaten, { origin: rawOrigin }: MailOrt): Mail {
  const aenderung = zugangsaenderungOf(daten);
  const urheber = urheberOf(daten);
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
