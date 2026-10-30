import { NACH_ERNENNUNG_NEU_ANMELDEN } from "@/features/berechtigungen/constants";
import { isRefusal } from "@/shared/utils/actionError";

/** An administrator's own address: their records go through the account page, or through an owner (`REQ-PURGE-005`). */
const EIGENE_ADRESSE_LOESCHEN =
  "Deine eigene Adresse löschst Du nicht hier. Lösche Dein Konto auf Deiner Kontoseite, oder lass Deine Adresse von einer Inhaberin oder einem Inhaber der Verwaltung löschen.";

const EIGENE_ADRESSE_ABMELDEN = "Deine eigenen Anmeldungen beendest Du auf Deiner Kontoseite.";

/** A grant holder's address, which only an owner's press reaches, as only an owner revokes a grant. */
const VERWALTUNG_LOESCHEN = `Diese Adresse hat Zugang zur Verwaltung. Löschen kann sie nur, wer Inhaberin oder Inhaber der Verwaltung ist. ${NACH_ERNENNUNG_NEU_ANMELDEN}`;

const INHABER_ABMELDEN = `Diese Adresse gehört einer Inhaberin oder einem Inhaber der Verwaltung. Abmelden kann sie nur, wer selbst Inhaberin oder Inhaber ist. ${NACH_ERNENNUNG_NEU_ANMELDEN}`;

/** The words each of the two refusals takes on a route, keyed by code so a third reaches the shared reader. */
function mapper(worte: Readonly<Record<string, string>>): (error: unknown) => { error: string } | null {
  return (error) => {
    if (!isRefusal(error)) return null;
    const satz = worte[error.serverErrorCode ?? ""];

    return satz === undefined ? null : { error: satz };
  };
}

/**
 * An owner's pending change the erasure would end, which the reveal leaves out for a reader holding no owner's power
 * (`REQ-PURGE-007`): it is ended only where it can be seen.
 */
const VERDECKTER_ADRESSWECHSEL = `Die Löschung würde eine laufende Adressänderung beenden, die nur sieht, wer Inhaberin oder Inhaber der Verwaltung ist. Lass die Adresse von einer Inhaberin oder einem Inhaber löschen. ${NACH_ERNENNUNG_NEU_ANMELDEN}`;

const LOESCHEN_WORTE: Readonly<Record<string, string>> = {
  "REQ-PURGE-003": EIGENE_ADRESSE_LOESCHEN,
  "REQ-PURGE-005": VERWALTUNG_LOESCHEN,
  "REQ-PURGE-007": VERDECKTER_ADRESSWECHSEL,
};

/**
 * The erasure's and its reveal's refusals, which judge the same address the same way; `null` for the rest, the
 * `DB-COMMON` pair among them, which the shared reader words.
 */
export const mapErasureRefusal = mapper(LOESCHEN_WORTE);

/**
 * Whether a failed reveal answered one of the erasure's own refusals, which the panel says alone: a reveal the rule
 * refused has loaded, and calling it a list that failed to load invites a retry the rule refuses again.
 */
export const isErasureRefusal = (satz: string): boolean => Object.values(LOESCHEN_WORTE).includes(satz);

/** The sign-out's refusals, in the sign-out's own words, `null` for the rest. */
export const mapAbmeldungRefusal = mapper({ "REQ-PURGE-003": EIGENE_ADRESSE_ABMELDEN, "REQ-PURGE-005": INHABER_ABMELDEN });
