import { KONTAKT_EMAIL } from "@/core/brand";
import { isRecordMissing } from "@/core/errors";
import { ADRESSWECHSEL_EINTRAG } from "@/features/admin/constants";
import { NACH_ERNENNUNG_NEU_ANMELDEN } from "@/features/berechtigungen/constants";
import { SPERRLISTE_ADRESSE_GESPERRT, SPERRLISTE_ADRESSE_GESPERRT_FELD } from "@/features/sperrliste/constants";
import { isRefusal, isRuleRefusal, refusedPayloadAnswer } from "@/shared/utils/actionError";
import { buildRefusal, LADE_DIE_SEITE_NEU } from "@/shared/utils/refusal";
import { ANTWORT_NEU_OEFFNEN } from "@/shared/utils/reopenLink";

import type { Code, FLApprovalDenied } from "@/core/generated/client/types";
import type { RefusalParts } from "@/shared/utils/refusal";
import type { FieldErrors } from "@/shared/utils/validation";
import type { EinsehbarVerwehrt } from "./einsehbar";
import type { AdresswechselLinkZustand } from "./link";

// ---- The link page ------------------------------------------------------------------------------

/**
 * A refused link read as the panel it renders, or `null` where the read failed instead. Every state a live
 * or ended change can be in answers in a 200, so a refusal is a token nothing could place.
 */
export function mapAdresswechselAnsichtRefusal(error: unknown): "invalid" | null {
  if (!isRefusal(error)) return null;

  // A token the backend will not parse matches no record, so the page calls the link void.
  if (error.serverErrorCode === "payload_refused") return "invalid";

  return isRuleRefusal(error) ? "invalid" : null;
}

/** What a refused press leaves the page showing: a panel, a re-read of the link, or the sentence of a drifted body. */
export type AdresswechselPresseRefusal = { zustand: AdresswechselLinkZustand } | { neuLesen: true } | ReturnType<typeof refusedPayloadAnswer>;

/** A refused answer or stop, or `null` where the code is none of these. */
export function mapAdresswechselPresseRefusal(error: unknown): AdresswechselPresseRefusal | null {
  if (!isRefusal(error)) return null;

  switch (error.serverErrorCode) {
    // The body shape is mirrored, so a refused one is a drifted page, which the mail's link replaces.
    case "body_unreadable":
    case "payload_refused":
      return refusedPayloadAnswer(error, ANTWORT_NEU_OEFFNEN);
    case "link_invalid":
      return { zustand: "invalid" };
    // The change ended, or this link was answered, since the page opened: the link's own read says which,
    // so the page states how it ended rather than calling a live or a finished change void.
    case "address_change_ended":
      return { neuLesen: true };
    case "link_expired":
      return { zustand: "expired" };
    case "link_barred":
      return { zustand: "barred" };
    // The replaced address barred, the new one another pupil's, the administration's or holding entries of its own, or a
    // grant the approval does not cover: one panel, so the link's holder learns nothing about who holds an address.
    case "address_change_replaced_barred":
    case "address_change_taken":
    case "address_change_not_covered":
    case "address_change_new_granted":
    case "address_change_occupied":
    case "duplicate_key":
      return { zustand: "not_confirmable" };
    default:
      return null;
  }
}

// ---- The account page ---------------------------------------------------------------------------

/** The new address folds to the one signed in: the box is the way out, so the sentence stands on it. */
const SCHON_ANGEMELDET = "Mit dieser Adresse bist Du schon angemeldet.";

/** The address holds nothing a change moves: only a page older than the records' end reaches it, the panel standing on the same read. */
const KEIN_EINTRAG = `Unter Deiner Adresse steht nichts mehr, dessen Adresse sich hier ändern lässt. Schreib uns an ${KONTAKT_EMAIL}.`;

/**
 * Nobody but the changed person and the change's starter could approve: an owner's change needs another
 * owner, which the last owner makes first, as the last owner's account deletion asks (`last_owner_erasure`).
 */
const NIEMAND_GENEHMIGT =
  "Eine neue Adresse für einen Zugang zur Verwaltung muss eine andere Person aus der Verwaltung genehmigen, und das kann gerade niemand. Ist Dein Zugang der einer Inhaberin oder eines Inhabers, mache zuerst eine andere Person zur Inhaberin oder zum Inhaber.";

/** The person's own start, or `null`, which the person spine's reader answers. */
export function mapKontoAdresswechselRefusal(error: unknown): { error?: string; fieldErrors?: FieldErrors } | null {
  if (!isRefusal(error)) return null;

  switch (error.serverErrorCode) {
    case "address_change_unchanged":
      return { error: SCHON_ANGEMELDET, fieldErrors: { email: SCHON_ANGEMELDET } };
    case "address_change_nothing":
      return { error: KEIN_EINTRAG };
    case "address_change_no_approver":
      return { error: NIEMAND_GENEHMIGT };
    default:
      return null;
  }
}

/** The approval, or `null`: a shown change awaiting no approval is the 404, and one replaced or stopped since the page loaded `address_change_ended`. */
export function mapKontoFreigabeRefusal(error: unknown): string | null {
  if (isRecordMissing(error)) return "Es wartet keine Änderung mehr auf Deine Freigabe. Lade die Seite neu.";
  if (!isRefusal(error)) return null;

  switch (error.serverErrorCode) {
    case "link_expired":
      return "Die Zeit für die Freigabe ist abgelaufen. Die Änderung wird gelöscht.";
    // Nothing approved: the page's change was replaced, and the reload shows the one standing now.
    case "address_change_ended":
      return "Diese Änderung ist inzwischen beendet, freigegeben ist nichts. Lade die Seite neu.";
    default:
      return null;
  }
}

/** The stop, or `null`: the one refusal is a change already gone, whose page the reload brings up to date. */
export function mapKontoStoppRefusal(error: unknown): string | null {
  return isRecordMissing(error) ? "Es wartet keine Änderung mehr. Lade die Seite neu." : null;
}

// ---- The address tool ---------------------------------------------------------------------------

/** An administrator's own address, whose change is their account page's (`own_adresse`). */
const EIGENE_ADRESSE = "Deine eigene Adresse änderst Du nicht hier, sondern auf Deiner Kontoseite.";

/** A grant holder's address, which only an owner's press reaches, as only an owner revokes a grant (`verwaltung_adresse`). */
const VERWALTUNG_ADRESSE = `Diese Adresse hat Zugang zur Verwaltung. Ändern kann sie hier nur, wer Inhaberin oder Inhaber der Verwaltung ist. ${NACH_ERNENNUNG_NEU_ANMELDEN}`;

const ZUGANG: Readonly<Record<string, string>> = { own_adresse: EIGENE_ADRESSE, verwaltung_adresse: VERWALTUNG_ADRESSE } satisfies Partial<
  Record<Code, string>
>;

/** The id a page or a link carried names a change since ended, which the reload shows as the address's present. */
const BEENDET = buildRefusal({ reason: "Diese Änderung ist schon beendet", repair: LADE_DIE_SEITE_NEU });

const UNBEKANNT = buildRefusal({ reason: "Diese Änderung gibt es nicht", repair: "Gib die Adresse ein, um die es geht" });

/** A reveal's refusal, said in the panel rather than as a list that failed to load. */
export function mapVerwaltungAnsichtRefusal(error: unknown): string | null {
  if (isRecordMissing(error)) return UNBEKANNT;
  if (!isRefusal(error)) return null;
  if (error.serverErrorCode === "address_change_ended") return BEENDET;

  return ZUGANG[error.serverErrorCode ?? ""] ?? null;
}

/** Whether a reveal's sentence is one of its own refusals, which the panel says alone rather than inviting a retry. */
export const isVerwaltungAnsichtRefusal = (satz: string): boolean => [UNBEKANNT, BEENDET, ...Object.values(ZUGANG)].includes(satz);

const NICHTS_ZU_AENDERN = buildRefusal({
  reason: "Unter dieser Adresse steht nichts, dessen Adresse sich hier ändern lässt",
  repair: LADE_DIE_SEITE_NEU,
});

const SCHON_HINTERLEGT = "Das ist schon die hinterlegte Adresse.";

const ADRESSE_BELEGT = "Mit dieser Adresse meldet sich schon eine andere Spielerin oder ein anderer Spieler an.";

/** The new address holds entries of its own (`address_change_occupied`): moving these onto it would join two people's. */
const EINTRAEGE_DA = "Unter der neuen Adresse stehen schon Einträge bei der Liga.";

/** No page here joins two addresses' entries, so the administrator is told it is a task by hand rather than sent to one. */
const NUR_VON_HAND = "Die Einträge beider Adressen lassen sich nur von Hand zusammenführen, nicht über diese Seite.";

/**
 * A sign-in account at the new address, which this server reads and the backend cannot (`kontoAnNeuerAdresse`). It may
 * be one the hourly account sweep removes, holding nothing, so a later try is named before the work by hand.
 */
const KONTO_DA = "Mit der neuen Adresse meldet sich schon jemand an.";

/** The tool's start onto an address an account signs in at, on its box as `address_change_occupied`'s is. */
export const KONTO_BELEGT_START = { error: `${KONTO_DA} Versuche es später erneut. ${NUR_VON_HAND}`, fieldErrors: { email: KONTO_DA } };

/** The re-send's, the panel holding no box: its way out is the later try or the discard. */
export const KONTO_BELEGT_ERNEUT = `${KONTO_DA} Versuche es später erneut, oder verwirf die Änderung. ${NUR_VON_HAND}`;

/** The tool's start, or `null`: a refusal of either value stands on its box, which is the way out. */
export function mapVerwaltungStartRefusal(error: unknown): { error?: string; fieldErrors?: FieldErrors } | null {
  // Published for the start, though no path of it answers 404 now: a lost race there is a retried write conflict.
  if (isRecordMissing(error)) return { error: KEIN_ADRESSWECHSEL };
  if (!isRefusal(error)) return null;

  const zugang = ZUGANG[error.serverErrorCode ?? ""];
  if (zugang !== undefined) return { error: zugang };

  switch (error.serverErrorCode) {
    case "address_change_nothing":
      return { error: NICHTS_ZU_AENDERN };
    case "address_change_unchanged":
      return { error: SCHON_HINTERLEGT, fieldErrors: { email: SCHON_HINTERLEGT } };
    case "address_change_barred":
      return { error: SPERRLISTE_ADRESSE_GESPERRT, fieldErrors: { email: SPERRLISTE_ADRESSE_GESPERRT_FELD } };
    case "address_change_taken":
      return { error: ADRESSE_BELEGT, fieldErrors: { email: ADRESSE_BELEGT } };
    case "address_change_occupied":
      return { error: `${EINTRAEGE_DA} ${NUR_VON_HAND}`, fieldErrors: { email: EINTRAEGE_DA } };
    case "address_change_no_approver":
      return {
        error:
          "Diese Änderung könnte gerade niemand aus der Verwaltung genehmigen. Bei einem Zugang als Inhaberin oder Inhaber mache zuerst eine weitere Person zur Inhaberin oder zum Inhaber, sonst gib einer weiteren Person Zugang zur Verwaltung.",
      };
    default:
      return null;
  }
}

// A re-send is offered only while the new mailbox is asked, so its 404 is a page older than the change's removal.
const KEIN_ADRESSWECHSEL = buildRefusal({ reason: "Diese Änderung gibt es nicht mehr", repair: LADE_DIE_SEITE_NEU });

/**
 * The shown change's re-send and discard, or `null`. Both name the change by its id, so a stale page meets the
 * end of that change and never acts on its successor.
 */
export function mapVerwaltungLinkRefusal(error: unknown): string | null {
  if (isRecordMissing(error)) return KEIN_ADRESSWECHSEL;
  if (!isRefusal(error)) return null;

  const zugang = ZUGANG[error.serverErrorCode ?? ""];
  if (zugang !== undefined) return zugang;

  switch (error.serverErrorCode) {
    case "address_change_ended":
      return BEENDET;
    case "address_change_barred":
      return SPERRLISTE_ADRESSE_GESPERRT;
    // The panel has no box, so the sentence names the way out it does hold.
    case "address_change_taken":
      return `${ADRESSE_BELEGT} Verwirf die Änderung und beginne eine mit einer anderen Adresse.`;
    // Entries reached the new address since the start: a fresh link would be refused on its press.
    case "address_change_occupied":
      return `${EINTRAEGE_DA} Verwirf die Änderung. ${NUR_VON_HAND}`;
    // The re-send's alone: a fresh link would be refused on its press, the change ending at the next pass.
    case "link_expired":
      return "Die Frist für die Genehmigung ist abgelaufen, die Änderung endet in der nächsten Stunde. Beginne sie danach neu.";
    default:
      return null;
  }
}

/** Who discards a change the approval left open, by why the tool refuses this approver, the tool's discard being the only one. */
function verwerfen(verwehrt: EinsehbarVerwehrt | null): Omit<RefusalParts, "reason"> {
  switch (verwehrt) {
    case null:
      return { repair: { before: "Verwirf sie", after: "" }, where: ADRESSWECHSEL_EINTRAG.label };
    case "verwaltung":
      return {
        repair: { before: "Frag eine Inhaberin oder einen Inhaber der Verwaltung, sie", after: "zu verwerfen" },
        where: ADRESSWECHSEL_EINTRAG.label,
      };
    // One's own change is refused its approval before the effect judges it, so this one is never reached by a press.
    case "own":
      return { repair: "Stoppe sie auf Deiner Kontoseite" };
  }
}

const ohneGenehmigung = (grund: string, verwehrt: EinsehbarVerwehrt | null): string =>
  buildRefusal({
    reason: `${grund}, deshalb ist nichts genehmigt. Die Änderung bleibt offen, bis sie verworfen wird oder abläuft`,
    ...verwerfen(verwehrt),
  });

/** The approval of a change whose new address an account signs in at, worded as the backend's `address_change_occupied` at the effect is. */
export const kontoBelegtGenehmigung = (verwehrt: EinsehbarVerwehrt | null): string =>
  ohneGenehmigung("Mit der neuen Adresse meldet sich inzwischen jemand an", verwehrt);

/**
 * Who approves an owner's change, closing every sentence that names who approves one: another administrator approves
 * a change, another owner alone an owner's.
 */
const INHABER_GENEHMIGT = "die neue Adresse eines Zugangs als Inhaberin oder Inhaber nur eine andere Inhaberin oder ein anderer Inhaber";

/**
 * Why this administrator may not approve, one sentence per reason for the closed press on the grant's row and the
 * refused one alike, as a request's are (`fl_frontend/src/features/berechtigungen/constants.ts ::
 * ANTRAG_ENTSCHEIDEN_VERWEHRT`). Each covers both tiers: the backend's codes name none.
 */
export const GENEHMIGUNG_VERWEHRT: Readonly<Record<FLApprovalDenied, string>> = {
  own: `Eine Änderung Deiner eigenen Adresse genehmigt eine andere Person aus der Verwaltung, ${INHABER_GENEHMIGT}.`,
  started: `Eine Änderung, die Du selbst begonnen hast, genehmigt eine andere Person aus der Verwaltung, ${INHABER_GENEHMIGT}.`,
  // An owner whose session predates their promotion holds no owner's power yet, and would read the bare rule as false.
  owner: `Die neue Adresse eines Zugangs als Inhaberin oder Inhaber genehmigt nur eine andere Inhaberin oder ein anderer Inhaber. ${NACH_ERNENNUNG_NEU_ANMELDEN}`,
  younger:
    "Genehmigen kann nur, wer schon vor dem Beginn der Änderung Zugang zur Verwaltung hatte, die neue Adresse eines Zugangs als Inhaberin oder Inhaber nur, wer schon vorher Inhaberin oder Inhaber war.",
};

/** Said beside the press it refuses, the administrators page holding the change's row. */
const genehmigungWorte = (verwehrt: EinsehbarVerwehrt | null): Readonly<Record<string, string>> =>
  ({
    address_change_approval_younger: GENEHMIGUNG_VERWEHRT.younger,
    address_change_ended: BEENDET,
    // The press itself ended the change, finding the address emptied since its start: never „schon beendet“.
    address_change_nothing:
      "Unter der bisherigen Adresse steht nichts mehr, das die Änderung mitnehmen könnte. Sie ist deshalb verworfen, und die neue Adresse erfährt, dass sie nicht wirksam geworden ist.",
    address_change_no_approval_open: buildRefusal({
      reason: "Diese Änderung wartet auf keine Genehmigung mehr",
      repair: LADE_DIE_SEITE_NEU,
    }),
    // One code for both of the press's own two reasons, so the one sentence naming both.
    address_change_approval_denied: `Eine Änderung Deiner eigenen Adresse oder eine, die Du selbst begonnen hast, genehmigt eine andere Person aus der Verwaltung, ${INHABER_GENEHMIGT}.`,
    address_change_approval_owner: GENEHMIGUNG_VERWEHRT.owner,
    link_expired: buildRefusal({ reason: "Diese Änderung ist abgelaufen", repair: LADE_DIE_SEITE_NEU }),
    // The effect's own refusals write nothing, the approval and the effect being one transaction: the change
    // stands unapproved until it is discarded or lapses.
    link_barred: ohneGenehmigung("Die neue Adresse steht auf der Sperrliste", verwehrt),
    address_change_replaced_barred: ohneGenehmigung("Die bisherige Adresse steht auf der Sperrliste", verwehrt),
    address_change_taken: ohneGenehmigung(
      "Mit der neuen Adresse meldet sich schon eine andere Spielerin oder ein anderer Spieler an",
      verwehrt,
    ),
    address_change_not_covered: ohneGenehmigung("Die Adresse hat inzwischen einen Zugang, den diese Genehmigung nicht abdeckt", verwehrt),
    address_change_new_granted: ohneGenehmigung("Die neue Adresse hat schon Zugang zur Verwaltung", verwehrt),
    address_change_occupied: ohneGenehmigung("Unter der neuen Adresse stehen inzwischen eigene Einträge", verwehrt),
  }) satisfies Partial<Record<Code, string>>;

/**
 * The approval's refusal, or `null`, `document_not_found` and `duplicate_key` among them, which the shared reader words. `verwehrt` is the
 * row's served reason the tool refuses this approver, which picks the discard's wording and nothing else.
 */
export function mapGenehmigungRefusal(error: unknown, verwehrt: EinsehbarVerwehrt | null): string | null {
  if (isRecordMissing(error)) return KEIN_ADRESSWECHSEL;
  if (!isRefusal(error)) return null;

  return genehmigungWorte(verwehrt)[error.serverErrorCode ?? ""] ?? null;
}
