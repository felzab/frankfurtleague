import "server-only";

import {
  ANTWORT_SATZ_HTML,
  ANTWORT_SATZ_TEXT,
  ASIDE_TEXT,
  BRAND_NAME,
  einzeilig,
  escapeHtml,
  mailOrigin,
  paragraph,
  renderKarte,
  strong,
  stuffSignatureDelimiter,
  textFooter,
} from "./emailShell";
import { ERASED_ACTOR_MARKER } from "./erasedActor";
import { OFFENE_ANTRAEGE } from "./seitenNamen";

export type BerechtigungEmail = { subject: string; html: string; text: string };

/** The zone a reader checks the stamp against, never the image's UTC. */
const ZEITZONE = "Europe/Berlin";

const BETREFF = `Änderung beim Zugang zur Verwaltung der ${BRAND_NAME}`;
const UEBERSCHRIFT = "Änderung beim Zugang zur Verwaltung";
const ZIEL_LABEL = "Zur Verwaltung";

const ZIEL_PFAD = "/bereich/admin/administratoren";

/** A change made outside the application names nobody, and says where it was made instead. */
const OHNE_VERWALTUNG = "Diese Änderung wurde nicht in der Verwaltung vorgenommen, sondern direkt in der Datenbank.";

/** What a reader does with the notice, and the whole of why every holder is sent it. */
const WARNSATZ = "Wenn Du diese Änderung nicht erwartet hast, melde Dich sofort bei den anderen Administratorinnen und Administratoren.";

/**
 * A request's own heading, subject and closing, by what it asks: it changes nobody's access and asks its reader to
 * decide it, and a promotion's subject already holds the access a grant's asks for.
 */
const ANTRAG: Readonly<Record<"zugang" | "ernennung", { ueberschrift: string; betreff: string; aufgabe: string }>> = {
  zugang: {
    ueberschrift: "Antrag auf Zugang zur Verwaltung",
    betreff: `Antrag auf Zugang zur Verwaltung der ${BRAND_NAME}`,
    aufgabe: `Genehmige oder lehne den Antrag in der Verwaltung unter „${OFFENE_ANTRAEGE}“ ab. Genehmige ihn nur, wenn Du sicher bist, dass die Person diesen Zugang bekommen soll.`,
  },
  ernennung: {
    ueberschrift: "Antrag auf Ernennung zur Inhaberin oder zum Inhaber",
    betreff: `Antrag auf Ernennung in der Verwaltung der ${BRAND_NAME}`,
    aufgabe: `Genehmige oder lehne den Antrag in der Verwaltung unter „${OFFENE_ANTRAEGE}“ ab. Genehmige ihn nur, wenn Du sicher bist, dass die Person Inhaberin oder Inhaber werden soll.`,
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

function zeitText(instant: string): string {
  return new Date(instant).toLocaleString("de-DE", { timeZone: ZEITZONE, dateStyle: "long", timeStyle: "short" });
}

/** The change's sentence, the address marked up by `wer` so the two parts each take their own form. */
function aenderungsSatz(aenderung: Zugangsaenderung, wer: (adresse: string) => string): string {
  const { adresse } = aenderung;
  const subjekt = typeof adresse === "string" ? wer(adresse) : OHNE_ADRESSE[adresse.vorenthalten];

  switch (aenderung.art) {
    case "erteilt": {
      // An `owner` grant says so: the application writes one only as an owner's address change moves it, the
      // rest coming from the database, and an owner's grant is the one a holder most needs told.
      const zugang = aenderung.inhaber ? `hat jetzt Zugang zur Verwaltung als ${INHABER}.` : "hat jetzt Zugang zur Verwaltung.";
      return `${subjekt} ${zugang}`;
    }
    case "entzogen":
      // An `owner` grant's end says so: an erasure ends one with no demotion before it, and the last owner's
      // end is the one a holder most needs told.
      return aenderung.inhaber
        ? `${subjekt} ist nicht mehr ${INHABER} der Verwaltung und hat keinen Zugang mehr.`
        : `${subjekt} hat keinen Zugang zur Verwaltung mehr.`;
    case "geaendert":
      return aenderung.inhaber
        ? `${subjekt} ist jetzt ${INHABER} der Verwaltung.`
        : `${subjekt} ist nicht mehr ${INHABER} der Verwaltung und behält den Zugang.`;
    case "beantragt":
      return aenderung.inhaber
        ? `Für ${subjekt} ist beantragt, ${INHABER} der Verwaltung zu werden.`
        : `Für ${subjekt} ist ein Zugang zur Verwaltung beantragt.`;
  }
}

/** The acting administrator in the notice's words, never a barred address or the erasure's marker. */
function urheberName(von: string | null, wer: (adresse: string) => string): string {
  if (von === null) return GESPERRTER_URHEBER;

  return von === ERASED_ACTOR_MARKER ? UNGENANNTER_URHEBER : wer(von);
}

/** The second sentence: who made it and when, or where a change nobody in the application made came from. */
function urheberSatz(urheber: Urheber, wer: (adresse: string) => string, verb = "Geändert"): string {
  if (urheber === null) return OHNE_VERWALTUNG;

  const von = urheberName(urheber.von, wer);
  return urheber.am === null ? `${verb} von ${von}.` : `${verb} von ${von} am ${wer(zeitText(urheber.am))}.`;
}

/** How a request ended, told to its requester alone. */
export type AntragEnde = {
  readonly art: "antrag_abgelehnt" | "antrag_beendet";
  // The address the request was for, or why it is withheld.
  readonly adresse: string | Vorenthalten;
  // Whether it asked for an owner's promotion rather than access.
  readonly inhaber: boolean;
};

/** The request as its requester asked it, the address marked up by `wer`. */
function antragSatz(ende: AntragEnde, wer: (adresse: string) => string): string {
  const { adresse } = ende;
  const fuer = typeof adresse === "string" ? wer(adresse) : ohneAdresseImSatz(adresse.vorenthalten);
  const antrag = ende.inhaber
    ? `Dein Antrag, ${fuer} zur Inhaberin oder zum Inhaber der Verwaltung zu ernennen,`
    : `Dein Antrag auf Zugang zur Verwaltung für ${fuer}`;

  return ende.art === "antrag_abgelehnt" ? `${antrag} wurde abgelehnt.` : `${antrag} endete, weil sich die Adresse geändert hat.`;
}

/**
 * A request's end, mailed to the administrator who asked for it under the request's own subject. It names the address they
 * asked about, which they typed, and nobody who acted: never who refused it.
 */
export function buildAntragEndeEmail(endeRoh: AntragEnde, rawOrigin: string): BerechtigungEmail {
  const origin = mailOrigin(rawOrigin);
  const ziel = `${origin}${ZIEL_PFAD}`;
  const { adresse } = endeRoh;
  const ende: AntragEnde = { ...endeRoh, adresse: typeof adresse === "string" ? einzeilig(adresse) : adresse };
  const antrag = ANTRAG[ende.inhaber ? "ernennung" : "zugang"];

  const html = renderKarte({
    titel: `${BRAND_NAME}: ${antrag.ueberschrift}`,
    ueberschrift: escapeHtml(antrag.ueberschrift),
    bloecke: [
      paragraph(
        antragSatz(ende, (value) => strong(escapeHtml(value))),
        "0",
      ),
    ],
    aktionen: [{ href: ziel, label: ZIEL_LABEL, ton: "primary" }],
    fuss: ANTWORT_SATZ_HTML,
    origin: origin,
  });

  const oben = [`${BRAND_NAME}: ${antrag.ueberschrift}`, "", antragSatz(ende, (value) => value), "", `${ZIEL_LABEL}: ${ziel}`];
  const text = [stuffSignatureDelimiter(oben.join("\n")), ...textFooter(origin, [ANTWORT_SATZ_TEXT])].join("\n");

  return { subject: antrag.betreff, html: html, text: text };
}

/**
 * **The body depends on the change alone**, never on when it is sent or to whom: a repeat under one key
 * must compose the same message for the provider to collapse it.
 */
export function buildBerechtigungEmail(aenderungRoh: Zugangsaenderung, urheberRoh: Urheber, rawOrigin: string): BerechtigungEmail {
  const origin = mailOrigin(rawOrigin);
  const ziel = `${origin}${ZIEL_PFAD}`;
  // Folded once, before either part prints them: this notice has no column of facts to fold them on the way,
  // and an `owner` grant reaches it from the database, past every check the API makes.
  const { adresse } = aenderungRoh;
  const aenderung: Zugangsaenderung = { ...aenderungRoh, adresse: typeof adresse === "string" ? einzeilig(adresse) : adresse };
  const urheber: Urheber = urheberRoh === null || urheberRoh.von === null ? urheberRoh : { ...urheberRoh, von: einzeilig(urheberRoh.von) };
  // A request is asked of its reader rather than told to them, so it is headed, signed and closed as one.
  const antrag = aenderung.art === "beantragt" ? ANTRAG[aenderung.inhaber ? "ernennung" : "zugang"] : null;
  const ueberschrift = antrag?.ueberschrift ?? UEBERSCHRIFT;
  const verb = antrag === null ? "Geändert" : "Beantragt";
  const schluss = antrag?.aufgabe ?? WARNSATZ;

  const html = renderKarte({
    titel: `${BRAND_NAME}: ${ueberschrift}`,
    ueberschrift: escapeHtml(ueberschrift),
    bloecke: [
      paragraph(aenderungsSatz(aenderung, (value) => strong(escapeHtml(value)))),
      paragraph(escapeHtml(urheberSatz(urheber, (value) => value, verb))),
      paragraph(escapeHtml(schluss), "0", ASIDE_TEXT),
    ],
    aktionen: [{ href: ziel, label: ZIEL_LABEL, ton: "primary" }],
    fuss: ANTWORT_SATZ_HTML,
    origin: origin,
  });

  const oben = [
    `${BRAND_NAME}: ${ueberschrift}`,
    "",
    aenderungsSatz(aenderung, (value) => value),
    "",
    urheberSatz(urheber, (value) => value, verb),
    "",
    `${ZIEL_LABEL}: ${ziel}`,
    "",
    schluss,
  ];
  const text = [stuffSignatureDelimiter(oben.join("\n")), ...textFooter(origin, [ANTWORT_SATZ_TEXT])].join("\n");

  return { subject: antrag?.betreff ?? BETREFF, html: html, text: text };
}
