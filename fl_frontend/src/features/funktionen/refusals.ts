import { isRefusal } from "@/shared/utils/actionError";

/** An administrator's own address: their records go through the account page, or through another administrator. */
const EIGENE_ADRESSE_LOESCHEN =
  "Deine eigene Adresse löschst Du nicht hier. Lösche Dein Konto auf Deiner Kontoseite, oder bitte eine andere Person aus der Verwaltung darum.";

const EIGENE_ADRESSE_ABMELDEN = "Deine eigenen Anmeldungen beendest Du auf Deiner Kontoseite.";

/** An owner's address, which only an owner's press reaches: an administrator could otherwise remove the people above them. */
const INHABER_LOESCHEN =
  "Diese Adresse gehört einer Inhaberin oder einem Inhaber der Verwaltung. Löschen kann sie nur, wer selbst Inhaberin oder Inhaber ist.";

const INHABER_ABMELDEN =
  "Diese Adresse gehört einer Inhaberin oder einem Inhaber der Verwaltung. Abmelden kann sie nur, wer selbst Inhaberin oder Inhaber ist.";

/** The words each of the two refusals takes on a route, keyed by code so a third reaches the shared reader. */
function mapper(worte: Readonly<Record<string, string>>): (error: unknown) => { error: string } | null {
  return (error) => {
    if (!isRefusal(error)) return null;
    const satz = worte[error.serverErrorCode ?? ""];

    return satz === undefined ? null : { error: satz };
  };
}

/**
 * The erasure's and its reveal's refusals, which judge the same address the same way; `null` for the rest, the
 * `DB-COMMON` pair among them, which the shared reader words.
 */
export const mapErasureRefusal = mapper({ "REQ-PURGE-003": EIGENE_ADRESSE_LOESCHEN, "REQ-PURGE-005": INHABER_LOESCHEN });

/** The sign-out's refusals, in the sign-out's own words, `null` for the rest. */
export const mapAbmeldungRefusal = mapper({ "REQ-PURGE-003": EIGENE_ADRESSE_ABMELDEN, "REQ-PURGE-005": INHABER_ABMELDEN });
