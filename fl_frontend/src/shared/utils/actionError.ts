import { APIBadStatusError, APIMalformedDataError, APINetworkError, mayHaveWritten } from "@/core/errors";

import { buildRefusal, UNKNOWN_REFUSAL } from "./refusal";

import type { SentRequest } from "@/core/errors";
import type { ActionFailure } from "@/shared/types/types";

/**
 * The Spiel refusals `fl_frontend/src/features/spiele/actions.ts :: mapSpielRefusal` does not map.
 * Three name an OCCUPANT, which the form places at fault; the two REQ-STATE codes name none, so
 * their code rides back unused and the message lands as a toast.
 */
const OCCUPANT_REFUSALS: Record<string, string> = {
  // Three triggers: a re-dating or a changed Sonderereignis fires the rule as a new club does. Its
  // remedies ride the match editor's rail, from
  // `fl_frontend/src/features/spiele/components/forms/AdminEditSpielDataForm/banners.ts`.
  "REQ-ELIGIBILITY-001": "Dieses Team ist aus der Saison ausgeschieden und darf ab seinem Austritt nicht mehr aufgestellt sein.",

  "REQ-ELIGIBILITY-002": "Dieses Team nimmt nicht an dieser Saison teil.",
  "REQ-STATE-002": "Ein Spiel mit diesem Sonderereignis wird nicht gewertet. Entferne zuerst die Tore.",
  "REQ-STATE-003": "Ein Nichtantreten braucht beide Teams. Besetze zuerst den offenen Platz.",
  // The repair is on the OTHER fixture, so it rides the same rail rather than this field.
  "REQ-SPIELTAG-001": "Dieses Team spielt am selben Spieltag schon in einem anderen Spiel.",
};

/** A write that may or may not have landed, marked so the toast titles it neither a success nor a failure. */
const OUTCOME_UNKNOWN: ActionFailure = {
  success: false,
  error: buildRefusal({ reason: "Ob die Änderung gespeichert wurde, ist unklar", repair: "Lade die Seite neu und prüfe, ob sie da ist" }),
  outcome: "unknown",
};

/**
 * An editor's answer to its own action rejecting, a dropped connection among the causes: the press may
 * have reached the server, and uncaught inside a transition the rejection replaces the editor with the
 * error page.
 */
export function unansweredAction(): ActionFailure {
  return { ...OUTCOME_UNKNOWN };
}

/**
 * Maps whatever a mutation threw onto the refusal the admin forms render. Each message names the way out rather
 * than the failure: the diagnosis is in the server log, and the toast's title says what became of the save.
 */
export function toActionErrorResult(error: unknown, answering?: SentRequest): ActionFailure {
  if (error instanceof APIBadStatusError) {
    if (error.statusCode === 409 && error.serverErrorCode === "REQ-WIRING-001") {
      // The form does not offer these shapes, so the request was built against a season that has since moved.
      return { success: false, error: "Die Saison wurde inzwischen geändert. Lade die Seite neu." };
    }
    if (error.statusCode === 409 && error.serverErrorCode === "REQ-WIRING-002") {
      // NOT the reload above: the form offered this answer and a reload only closes it, so what the
      // admin wanted needs a different source rather than a fresh page.
      return {
        success: false,
        error: buildRefusal({
          reason:
            "Eine Seite dieses Spiels hat als Herkunft einen Platz in einer Gruppe, und das ist nur in der ersten KO-Runde der Saison möglich",
          repair: "Wähle für diese Seite stattdessen ein früheres Spiel als Herkunft, oder setze das Team manuell",
        }),
      };
    }
    if (error.statusCode === 409 && error.serverErrorCode === "REQ-WIRING-003") {
      // The picker offers only the season's own groups, so this arriving means the season was
      // redrawn narrower under the open form: the offer itself is stale, and a reload renews it.
      return {
        success: false,
        error: buildRefusal({
          reason: "Als Herkunft ist ein Platz in einer Gruppe gewählt, die es in dieser Saison nicht gibt",
          repair: "Lade die Seite neu und wähle dann eine Gruppe dieser Saison",
        }),
      };
    }
    if (error.statusCode === 409 && error.serverErrorCode !== undefined) {
      // The code is an unvalidated wire string, and an unguarded lookup reaches `Object.prototype`: `toString` selects a function.
      const occupantRefusal = Object.hasOwn(OCCUPANT_REFUSALS, error.serverErrorCode) ? OCCUPANT_REFUSALS[error.serverErrorCode] : undefined;
      if (occupantRefusal !== undefined) {
        // Unlike the stale-form refusal above, reloading fixes none of these. The code rides back out
        // so the form can put the message on the side that caused it.
        return { success: false, error: occupantRefusal, errorCode: error.serverErrorCode };
      }
    }
    if (error.statusCode === 409) {
      // The ordinary outcome of a create hitting a unique index (DB-COMMON-002), possibly a retired row keeping its slot.
      return { success: false, error: "Der Eintrag steht im Konflikt mit einem, den es schon gibt." };
    }
    if (error.statusCode === 404) {
      return { success: false, error: "Der Eintrag wurde nicht gefunden. Lade die Seite neu." };
    }
    if (error.statusCode === 500 && error.serverErrorCode === "DB-FAIL-002") {
      // A commit went unanswered, or the deadline cut a write, so the write may stand: "try again"
      // would repeat it, and the retry then meets its own "already exists".
      return { ...OUTCOME_UNKNOWN };
    }
    // Only `DB-FAIL-001` says the write failed: any other 5xx can follow a commit, an unhandled crash
    // or a proxy's own answer among them.
    if (error.statusCode >= 500 && error.serverErrorCode !== "DB-FAIL-001" && mayHaveWritten(error)) return { ...OUTCOME_UNKNOWN };

    return { success: false, error: "Der Server hat mit einem Fehler geantwortet. Versuche es erneut." };
  }

  if (error instanceof APINetworkError) {
    // A write whose answer never arrived may have landed, which a retry would repeat: a connection
    // lost after the send is as silent as a timeout. A read changed nothing, and trying again repairs it.
    if (mayHaveWritten(error)) return { ...OUTCOME_UNKNOWN };

    return {
      success: false,
      error: error.isTimeout
        ? "Der Server hat zu lange nicht geantwortet. Versuche es erneut."
        : "Der Server ist gerade nicht erreichbar. Versuche es später erneut.",
    };
  }

  if (error instanceof APIMalformedDataError) {
    // A 2xx whose body failed its schema: the write landed, and only its answer is unreadable.
    if (mayHaveWritten(error)) return { ...OUTCOME_UNKNOWN };

    return { success: false, error: "Die Daten kamen fehlerhaft an. Versuche es erneut." };
  }

  // This application's own throw carries no request, so the one its caller answers stands in: thrown
  // after a write, it leaves the row standing under a failure's title.
  if (answering !== undefined && mayHaveWritten(answering)) return { ...OUTCOME_UNKNOWN };

  return { success: false, error: UNKNOWN_REFUSAL };
}
