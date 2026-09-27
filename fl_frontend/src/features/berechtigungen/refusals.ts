import { isRefusal, ZUGANG_WEG } from "@/shared/utils/actionError";

import type { FieldErrors } from "@/shared/utils/validation";

/** Both the rule and the unique index, which answers the same grant where two administrators press together. */
const SCHON_ZUGANG = "Diese Adresse hat bereits Zugang zur Verwaltung.";

const GESPERRT = "Diese Adresse ist gesperrt. Hebe zuerst die Sperre auf, wenn sie Zugang zur Verwaltung erhalten soll.";

/** `null` where the refusal is something else. The address box carries what the typed address caused. */
export function mapErteilenRefusal(error: unknown): { error?: string; fieldErrors?: FieldErrors } | null {
  if (!isRefusal(error)) return null;

  // No repair sentence: the box carrying the message is itself the way out (`docs/frontend/spec.md` §1.12).
  if (error.serverErrorCode === "REQ-BERECHTIGUNG-001" || error.serverErrorCode === "DB-COMMON-002") {
    return { fieldErrors: { email: SCHON_ZUGANG } };
  }

  if (error.serverErrorCode === "REQ-BERECHTIGUNG-003") return { fieldErrors: { email: GESPERRT } };

  // The acting administrator's own grant went while the page stood; no box repairs that.
  if (error.serverErrorCode === "REQ-BERECHTIGUNG-006") return { error: ZUGANG_WEG };

  return null;
}

/** `null` where the refusal is something else; a revoke has no box, so each reason is the toast's. */
export function mapEntziehenRefusal(error: unknown): { error?: string } | null {
  if (!isRefusal(error)) return null;

  switch (error.serverErrorCode) {
    case "REQ-BERECHTIGUNG-005":
      return { error: "Den Zugang entziehen kann nur der Inhaber." };
    case "REQ-BERECHTIGUNG-002":
      return { error: "Der Zugang des Inhabers lässt sich hier nicht ändern." };
    case "REQ-BERECHTIGUNG-004":
      return { error: "Die Verwaltung braucht mindestens zwei Personen mit Zugang. Füge zuerst eine weitere hinzu." };
    default:
      return null;
  }
}
