import { NACH_ERNENNUNG_NEU_ANMELDEN } from "@/features/berechtigungen/constants";
import { isRefusal } from "@/shared/utils/actionError";

import type { FieldErrors } from "@/shared/utils/validation";

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

const LOESCHEN_WORTE: Readonly<Record<string, string>> = { "REQ-PURGE-003": EIGENE_ADRESSE_LOESCHEN, "REQ-PURGE-005": VERWALTUNG_LOESCHEN };

const mapLoeschenRefusal = mapper(LOESCHEN_WORTE);

/**
 * Said on the box, one sentence about the value: its hint and placeholder say what it may hold (`docs/frontend/spec.md`
 * §1.12). The refusal names no word and takes a common word equal to a name.
 */
const NAME_IM_ANLASS = "Der Anlass enthält ein Wort, das einem Namen der Person gleicht.";

/**
 * The erasure's and its reveal's refusals, which judge the same address the same way, and the erasure's of its Anlass;
 * `null` for the rest, the `DB-COMMON` pair among them, which the shared reader words.
 */
export function mapErasureRefusal(error: unknown): { error?: string; fieldErrors?: FieldErrors } | null {
  if (isRefusal(error) && error.serverErrorCode === "REQ-PURGE-006") return { fieldErrors: { anlass: NAME_IM_ANLASS } };

  return mapLoeschenRefusal(error);
}

/**
 * Whether a failed reveal answered one of the erasure's own refusals, which the panel says alone: a reveal the rule
 * refused has loaded, and calling it a list that failed to load invites a retry the rule refuses again.
 */
export const isErasureRefusal = (satz: string): boolean => Object.values(LOESCHEN_WORTE).includes(satz);

/** The sign-out's refusals, in the sign-out's own words, `null` for the rest. */
export const mapAbmeldungRefusal = mapper({ "REQ-PURGE-003": EIGENE_ADRESSE_ABMELDEN, "REQ-PURGE-005": INHABER_ABMELDEN });
