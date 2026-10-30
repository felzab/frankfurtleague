import { isRecordMissing } from "@/core/errors";
import { isRefusal } from "@/shared/utils/actionError";
import { buildRefusal, LADE_DIE_SEITE_NEU } from "@/shared/utils/refusal";

import {
  ADRESSE_GESPERRT,
  ANTRAG_EIGENE_ODER_GESTELLT,
  ANTRAG_ENTSCHEIDEN_VERWEHRT,
  ANTRAG_OFFEN,
  ANTRAG_VERFALLEN,
  INHABER_GESPERRT,
  NACH_ERNENNUNG_NEU_ANMELDEN,
  NUR_INHABER_ENTZIEHT,
} from "./constants";

import type { Code } from "@/core/generated/client/types";
import type { FieldErrors } from "@/shared/utils/validation";

/** Both the rule and the unique index, which answers the same grant where two administrators press together. */
const SCHON_ZUGANG = "Diese Adresse hat bereits Zugang zur Verwaltung.";

/** `null` where the refusal is something else. The address box carries what the typed address caused. */
export function mapErteilenRefusal(error: unknown): { error?: string; fieldErrors?: FieldErrors } | null {
  if (!isRefusal(error)) return null;

  // No repair sentence: the box carrying the message is itself the way out.
  if (error.serverErrorCode === "grant_exists" || error.serverErrorCode === "duplicate_key") {
    return { fieldErrors: { email: SCHON_ZUGANG } };
  }

  if (error.serverErrorCode === "grant_barred") return { fieldErrors: { email: ADRESSE_GESPERRT } };
  if (error.serverErrorCode === "grant_approval_request_open") return { fieldErrors: { email: ANTRAG_OFFEN } };

  return null;
}

/** `null` where the refusal is something else; a revoke has no box, so each reason is the toast's. */
export function mapEntziehenRefusal(error: unknown): { error?: string } | null {
  if (!isRefusal(error)) return null;

  switch (error.serverErrorCode) {
    case "grant_only_owner":
      return { error: NUR_INHABER_ENTZIEHT };
    // An owner is demoted first and revoked after, which the repair names.
    case "grant_owner":
      return {
        error: "Einer Inhaberin oder einem Inhaber lässt sich der Zugang nicht entziehen. Stufe die Person zuerst zur Verwaltung herab.",
      };
    case "grant_minimum_count":
      return { error: "Die Verwaltung braucht mindestens zwei Personen mit Zugang. Füge zuerst eine weitere hinzu." };
    default:
      return null;
  }
}

/** `null` where the refusal is something else; the tier change has no box either. */
export function mapStufeRefusal(error: unknown): { error?: string } | null {
  if (!isRefusal(error)) return null;

  switch (error.serverErrorCode) {
    // The acting owner was demoted while the page stood, another owner's demotion among the ways.
    case "grant_only_owner":
      return { error: `Die Stufe eines Zugangs ändern können nur Inhaberinnen und Inhaber. ${NACH_ERNENNUNG_NEU_ANMELDEN}` };
    case "grant_barred":
      return { error: INHABER_GESPERRT };
    // The last owner's demotion, their own step-down included.
    case "grant_last_owner":
      return {
        error:
          "Die Verwaltung braucht mindestens eine Inhaberin oder einen Inhaber. Ernenne zuerst eine weitere Person zur Inhaberin oder zum Inhaber.",
      };
    // A promotion whose request waits already, asked by another owner or by this one.
    case "grant_approval_request_open":
      return { error: ANTRAG_OFFEN };
    default:
      return null;
  }
}

/** Decided, withdrawn or lapsed since the page loaded, or a promotion whose grant has gone: the reload shows what stands. */
const NICHT_MEHR_OFFEN = buildRefusal({ reason: "Dieser Antrag ist nicht mehr offen", repair: LADE_DIE_SEITE_NEU });

/** Who may decide, the same for an approval and a refusal: `grant_approval_denied` is the subject's alone on a refusal, its requester withdrawing. */
const ENTSCHEIDEN_WORTE: Readonly<Record<string, string>> = {
  grant_approval_denied: ANTRAG_ENTSCHEIDEN_VERWEHRT.own,
  grant_approval_owner: ANTRAG_ENTSCHEIDEN_VERWEHRT.owner,
  grant_approval_younger: ANTRAG_ENTSCHEIDEN_VERWEHRT.younger,
} satisfies Partial<Record<Code, string>>;

/**
 * Said beside the approval's press. The address's own refusals write nothing, the approval and the grant being one
 * transaction: the request stands until it is refused or lapses, so each names the refusal as the way out.
 */
const GENEHMIGUNG_WORTE: Readonly<Record<string, string>> = {
  ...ENTSCHEIDEN_WORTE,
  grant_approval_denied: ANTRAG_EIGENE_ODER_GESTELLT,
  grant_approval_request_lapsed: ANTRAG_VERFALLEN,
  grant_exists: "Diese Adresse hat inzwischen Zugang zur Verwaltung, deshalb ist nichts genehmigt. Lehne den Antrag ab.",
  grant_barred: "Diese Adresse ist inzwischen gesperrt, deshalb ist nichts genehmigt. Lehne den Antrag ab, oder hebe zuerst die Sperre auf.",
} satisfies Partial<Record<Code, string>>;

/** The approval's refusal, or `null`, the unique index's among them, which the shared reader words. */
export function mapAntragGenehmigungRefusal(error: unknown): string | null {
  if (isRecordMissing(error)) return NICHT_MEHR_OFFEN;
  if (!isRefusal(error)) return null;

  return GENEHMIGUNG_WORTE[error.serverErrorCode ?? ""] ?? null;
}

/** The refusal's or the withdrawal's refusal, or `null`. */
export function mapAntragAblehnungRefusal(error: unknown): string | null {
  if (isRecordMissing(error)) return NICHT_MEHR_OFFEN;
  if (!isRefusal(error)) return null;

  return ENTSCHEIDEN_WORTE[error.serverErrorCode ?? ""] ?? null;
}
