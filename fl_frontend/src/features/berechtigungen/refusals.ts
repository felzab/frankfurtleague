import { isRefusal } from "@/shared/utils/actionError";

import { ADRESSE_GESPERRT, INHABER_GESPERRT, NUR_INHABER_ENTZIEHT } from "./constants";

import type { FieldErrors } from "@/shared/utils/validation";

/** Both the rule and the unique index, which answers the same grant where two administrators press together. */
const SCHON_ZUGANG = "Diese Adresse hat bereits Zugang zur Verwaltung.";

/** `null` where the refusal is something else. The address box carries what the typed address caused. */
export function mapErteilenRefusal(error: unknown): { error?: string; fieldErrors?: FieldErrors } | null {
  if (!isRefusal(error)) return null;

  // No repair sentence: the box carrying the message is itself the way out (`docs/frontend/spec.md` §1.12).
  if (error.serverErrorCode === "REQ-BERECHTIGUNG-001" || error.serverErrorCode === "DB-COMMON-002") {
    return { fieldErrors: { email: SCHON_ZUGANG } };
  }

  if (error.serverErrorCode === "REQ-BERECHTIGUNG-003") return { fieldErrors: { email: ADRESSE_GESPERRT } };

  return null;
}

/** `null` where the refusal is something else; a revoke has no box, so each reason is the toast's. */
export function mapEntziehenRefusal(error: unknown): { error?: string } | null {
  if (!isRefusal(error)) return null;

  switch (error.serverErrorCode) {
    case "REQ-BERECHTIGUNG-005":
      return { error: NUR_INHABER_ENTZIEHT };
    // An owner is demoted first and revoked after, which the repair names.
    case "REQ-BERECHTIGUNG-002":
      return { error: "Einem Inhaber lässt sich der Zugang nicht entziehen. Stufe ihn zuerst zur Verwaltung herab." };
    case "REQ-BERECHTIGUNG-004":
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
    case "REQ-BERECHTIGUNG-005":
      return { error: "Die Stufe eines Zugangs ändern kann nur der Inhaber." };
    case "REQ-BERECHTIGUNG-003":
      return { error: INHABER_GESPERRT };
    // The last owner's demotion, their own step-down included.
    case "REQ-BERECHTIGUNG-007":
      return { error: "Die Verwaltung braucht mindestens einen Inhaber. Ernenne zuerst eine weitere Person zum Inhaber." };
    default:
      return null;
  }
}
