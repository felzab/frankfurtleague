import { APIBadStatusError } from "@/core/errors";
import { buildRefusal } from "@/shared/utils/refusal";

import type { FieldErrors } from "@/shared/utils/validation";

// Two messages for one unique index, which spans retired clubs. Only the create can be answered by
// reaching for the club already holding the letters; an edit has this club open and needs the field.
export const SHORTHAND_TAKEN_ON_CREATE = "Dieses Kürzel hat schon ein anderes Team, vielleicht ein stillgelegtes, das Du reaktivieren kannst.";
export const SHORTHAND_TAKEN_ON_EDIT = "Bitte wähle ein anderes Kürzel: dieses hat schon ein anderes Team, vielleicht ein stillgelegtes.";

/** `null` where the error is no 409. Every 409 is `taken`: a club's only unique key is its shorthand. */
export function mapShorthandRefusal(error: unknown, taken: string): { fieldErrors: FieldErrors } | null {
  if (!(error instanceof APIBadStatusError) || error.statusCode !== 409) return null;

  return { fieldErrors: { shorthand: taken } };
}

/** `null` where the 409 is something else; it lands on no field, the retire control being a dialog. */
export function mapRetireRefusal(error: unknown): string | null {
  if (!(error instanceof APIBadStatusError) || error.statusCode !== 409 || error.serverErrorCode !== "REQ-RETIRE-001") return null;

  return "Das Team spielt in einer laufenden oder geplanten Saison und kann nicht stillgelegt werden.";
}

/**
 * `null` where the error is no 409. Asked after `mapEntryRefusal`, so what reaches it is the unique
 * index on the junction's natural key: the club already stands in the season.
 */
export function mapAlreadyEnteredRefusal(error: unknown): string | null {
  if (!(error instanceof APIBadStatusError) || error.statusCode !== 409) return null;

  return "Dieses Team ist schon in dieser Saison. Lade die Seite neu.";
}

export function mapEntryRefusal(error: unknown): { error?: string; fieldErrors?: FieldErrors } | null {
  if (!(error instanceof APIBadStatusError) || error.statusCode !== 409) return null;
  if (error.serverErrorCode === "REQ-ENTER-001") {
    // `REQ-ENTER-001` to `-003` open with the sentence
    // `fl_frontend/src/features/bewerbungen/refusals.ts :: mapTriageRefusal` renders too, so only the
    // repair below is this one's own; `fl_frontend/src/features/bewerbungen/actions.test.ts` holds the pairs equal.
    return {
      error: buildRefusal({
        reason: "Diese Saison ist nicht mehr in Planung, und aufgenommen wird nur in eine geplante Saison",
        repair: "Nimm das Team in eine geplante Saison auf",
      }),
    };
  }
  // Both land under the `gruppe` picker, which is itself the way out, so neither carries a repair
  // sentence (`docs/frontend/spec.md` §1.12).
  if (error.serverErrorCode === "REQ-ENTER-002") {
    return { fieldErrors: { gruppe: "Diese Gruppe gibt es in dieser Saison nicht." } };
  }
  if (error.serverErrorCode === "REQ-ENTER-003") {
    return { fieldErrors: { gruppe: "Diese Gruppe ist schon voll." } };
  }
  if (error.serverErrorCode === "REQ-ENTER-004") {
    // Names the route still open rather than stopping at the refusal: the swap control sits under
    // the locked Gruppe row on the page this message lands on.
    return {
      error:
        "Für dieses Team sind in dieser Saison schon Spiele angelegt, deshalb kann es die Gruppe nicht allein wechseln. Tausche die Gruppe stattdessen mit einem zweiten Team, unter der gesperrten Gruppe auf dieser Seite.",
    };
  }
  if (error.serverErrorCode === "REQ-ENTER-005") {
    // Raised only by the club editor's season panel, and only while its page still believes the club
    // is active — so the words are `buildTeamBanners`'s, which the same panel shows once the page
    // catches up.
    return {
      error:
        "Dieses Team ist inzwischen stillgelegt und kann in keine Saison aufgenommen werden. Reaktiviere es über den Kopf der Seite und nimm es danach hier auf.",
    };
  }
  return null;
}

/**
 * Every refusal a replacement can answer with. Its own mapper beside `mapEntryRefusal`: the two
 * answer `REQ-ENTER-005` about different clubs, and one message would be wrong on one of them.
 */
export function mapReplacementRefusal(error: unknown): string | null {
  if (!(error instanceof APIBadStatusError)) return null;

  // The three subjects the endpoint actually resolves. The outgoing club is not among them — a row
  // naming a club that does not exist is what this endpoint REPAIRS — so no message may claim it.
  if (error.statusCode === 404) {
    return "Saison, Saison-Zugehörigkeit oder das nachrückende Team wurde nicht gefunden. Lade die Seite neu und wähle erneut.";
  }
  if (error.statusCode !== 409) return null;

  if (error.serverErrorCode === "REQ-REPLACE-001") {
    // No reload repairs a finished season, so the sentence names the seasons still open instead.
    return "Diese Saison ist abgeschlossen. Ersetzen lässt sich ein Team nur in einer laufenden oder geplanten Saison.";
  }
  if (error.serverErrorCode === "REQ-REPLACE-002") {
    // The five shapes that leave a record, and only those: an ausgefallenes or annulliertes Spiel
    // leaves none, so naming either would send the admin looking at a fixture that is still free.
    // The Austritt is on another page; the sentence says which.
    return "Mindestens ein Spiel des ausscheidenden Teams trägt ein Ergebnis, Tore, ein Elfmeterschießen, einen Abbruch oder ein Nichtantreten. Trage für dieses Team stattdessen unten auf seiner eigenen Team-Seite einen Austritt ein.";
  }
  if (error.serverErrorCode === "REQ-REPLACE-003") {
    // One code, two pictures: a club named on both ends lands here too, because the row being
    // replaced is one that club holds. PLATZ and never „spielt“ — the condition is a `saison_teams`
    // row of ANY kind, and a withdrawn club still holds one.
    return "Das nachrückende Team hat in dieser Saison schon einen Platz, oder Du hast für beide Seiten dasselbe Team gewählt. Wähle ein Team ohne Platz in dieser Saison; ein ausgeschiedenes behält seinen.";
  }
  if (error.serverErrorCode === "REQ-ENTER-005") {
    // The club the admin PICKED, never the one whose page is open, so the reactivation is not the
    // one `mapEntryRefusal` points at.
    return "Das nachrückende Team ist stillgelegt und kann in keine Saison aufgenommen werden. Reaktiviere es über den Kopf seiner eigenen Team-Seite und wähle es danach hier erneut.";
  }
  return null;
}
