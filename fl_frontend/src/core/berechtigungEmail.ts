import "server-only";

import { mailOrigin } from "./emailShell";
import { ERASED_ACTOR_MARKER } from "./erasedActor";
import { formatInstant } from "./format";
import { OFFENE_ANTRAEGE } from "./seitenNamen";

import type { Mail, Run } from "./emailShell";
import type { FLGrantData, FLGrantDataChange, FLGrantDataWithheld, FLGrantSnapshot } from "./generated/client/types";
import type { MailOrigin } from "./mailKinds";

const BETREFF = "Änderung beim Zugang zur Verwaltung";
const ZIEL_LABEL = "Zur Verwaltung";

const ZIEL_PFAD = "/area/admin/administratoren";

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
type Vorenthalten = { readonly withheld: NonNullable<FLGrantDataWithheld> };

/** One change as the notice states it. */
type Zugangsaenderung = {
  // `requested`: a grant or a promotion asked for, sent to whoever could approve it.
  readonly art: FLGrantDataChange;
  readonly adresse: string | Vorenthalten;
  // The `owner` tier the grant holds now, or held until it ended.
  readonly owner: boolean;
};

/**
 * Who made the change and when, or `null` where it was made in the database directly. `by` is null for an
 * administrator since barred, and `ERASED_ACTOR_MARKER` for one erased since, neither of whom the notice names.
 */
type Urheber = { readonly by: string | null; readonly at: string | null } | null;

/** A withheld grant address, in the subject's place. An erased person's is named by nothing, not even that state. */
const OHNE_ADRESSE: Readonly<Record<Vorenthalten["withheld"], string>> = {
  barred: "Eine gesperrte Adresse",
  erased: "Eine nicht genannte Adresse",
};

/** The `owner` tier as a person of either gender holds it, never the masculine word for both. */
const INHABER = "Inhaberin oder Inhaber";

/** The acting administrator where a ban withholds them. */
const GESPERRTER_URHEBER = "einer gesperrten Adresse";

/** The acting administrator where they have been erased since. */
const UNGENANNTER_URHEBER = "einer nicht genannten Adresse";

/** The change's sentence, a named address set in the emphasis grade. */
function aenderungsSatz({ art, adresse, owner }: Zugangsaenderung): readonly Run[] {
  const subject: Run = typeof adresse === "string" ? { strong: adresse } : OHNE_ADRESSE[adresse.withheld];

  switch (art) {
    case "granted":
      // An `owner` grant says so: the application writes one only as an owner's address change moves it, the
      // rest coming from the database, and an owner's grant is the one a holder most needs told.
      return [subject, owner ? ` hat jetzt Zugang zur Verwaltung als ${INHABER}.` : " hat jetzt Zugang zur Verwaltung."];
    case "revoked":
      // An `owner` grant's end says so: an erasure ends one with no demotion before it, and the last owner's
      // end is the one a holder most needs told.
      return [
        subject,
        owner ? ` ist nicht mehr ${INHABER} der Verwaltung und hat keinen Zugang mehr.` : " hat keinen Zugang zur Verwaltung mehr.",
      ];
    case "changed":
      return [subject, owner ? ` ist jetzt ${INHABER} der Verwaltung.` : ` ist nicht mehr ${INHABER} der Verwaltung und behält den Zugang.`];
    case "requested":
      return owner
        ? ["Für ", subject, ` ist beantragt, ${INHABER} der Verwaltung zu werden.`]
        : ["Für ", subject, " ist ein Zugang zur Verwaltung beantragt."];
  }
}

/**
 * The acting administrator in the notice's words, never a barred address or the erasure's marker: a named address in
 * the emphasis grade, as the change's own subject is, a withheld one plain.
 */
function urheberName(by: string | null): Run {
  if (by === null) return GESPERRTER_URHEBER;

  return by === ERASED_ACTOR_MARKER ? UNGENANNTER_URHEBER : { strong: by };
}

/** The second sentence: who made it and when, or where a change nobody in the application made came from. */
function urheberSatz(urheber: Urheber, verb: string): readonly Run[] {
  if (urheber === null) return [OHNE_VERWALTUNG];

  return [`${verb} von `, urheberName(urheber.by), urheber.at === null ? "." : ` am ${formatInstant(urheber.at)}.`];
}

/** A grant's address as the notice names it, or why it is withheld: a barred one, or an erased person's. */
function adresseOf(data: FLGrantData, stand: FLGrantSnapshot | null): string | Vorenthalten {
  return stand?.address ?? { withheld: data.withheld ?? "barred" };
}

/**
 * A change as the notice words it. An address repointed under one id reaches here as two changes, its
 * removal and the new address's grant, so a `geaendert` is a change of tier alone.
 */
function zugangsaenderungOf(data: FLGrantData): Zugangsaenderung {
  const stand = data.change === "revoked" ? data.before : data.current;

  return { art: data.change, adresse: adresseOf(data, stand), owner: stand?.admin_tier === "owner" };
}

/** Read off `urheber`, never off a null actor: an application's change whose actor is withheld is a barred one's. */
function urheberOf(data: FLGrantData): Urheber {
  if (data.author === "datenbank") return null;

  return { by: data.changed_by, at: data.changed_at };
}

/** **The body depends on the change alone**, never on when it is sent or to whom: every holder is owed the same notice. */
export function buildBerechtigungEmail(data: FLGrantData, { origin: rawOrigin }: MailOrigin): Mail {
  const aenderung = zugangsaenderungOf(data);
  const urheber = urheberOf(data);
  const origin = mailOrigin(rawOrigin);
  // A request is asked of its reader rather than told to them, so it is headed, signed and closed as one.
  const approvalRequest = aenderung.art === "requested" ? ANTRAG[aenderung.owner ? "ernennung" : "zugang"] : null;

  return {
    kind: "notice",
    subjectLine: approvalRequest?.betreff ?? BETREFF,
    origin: origin,
    vorname: "",
    paragraphs: [
      [aenderungsSatz(aenderung)],
      [urheberSatz(urheber, approvalRequest === null ? "Geändert" : "Beantragt")],
      approvalRequest?.aufgabe ?? [WARNSATZ],
    ],
    button: { label: ZIEL_LABEL, href: `${origin}${ZIEL_PFAD}` },
  };
}
