import { FLEinwilligungUmfang } from "@/core/generated/client/types";
import { BEWERBUNG_MAX_ALTER } from "@/features/bewerbungen/constants";

// Its own module: every export of a `"use client"` view becomes a client reference, which the page cannot read.
export const REGISTRIERUNGEN_CRUD_COPY = {
  // The pupil's name and the team are what a card shows, so they are what the bar can reach: no address.
  searchLabel: "Registrierungen suchen",
  searchPlaceholder: "z.B. Erika Mustermann oder Goethe-Gymnasium",
  // Two rather than three: the page declares no facet, so `filtered` is reachable by no press.
  emptyForQuery: "Keine Registrierungen für diese Suche.",
  emptyOverall: "Es gibt keine offenen Registrierungen.",
} as const;

/**
 * Both states of the pupil's own confirmation carry a mark: with one state marked alone, a mark that
 * failed to render would read as the other.
 */
export const BESTAETIGT_MARKE = { ja: "Bestätigt", nein: "Noch nicht bestätigt" } as const;

/**
 * The pupil's confirmation deadline, mirrored from `fl_backend/app/shared/schemas/bounds.py`.
 *
 * Shorter than the application's fourteen because it carries a second job: it is the window inside
 * which a mistyped address is discovered.
 */
export const REGISTRIERUNG_BESTAETIGUNG_FRIST_TAGE = 7;

// Retyped from `fl_backend/app/shared/schemas/bounds.py` for the published notice, which states the
// floor with no answer to read it off. The form still takes the served `mindestalter` below: a page
// judging a date against this copy would refuse where the endpoint accepts.
export const REGISTRIERUNG_MIN_ALTER = 16;

// Retyped from `fl_backend/app/shared/schemas/bounds.py` for the published notice as well, which
// states the media floor for pupils and referees alike; the pages take the served
// `medien_mindestalter` for the reason given above.
export const MEDIEN_MIN_ALTER = 18;

/**
 * The publication question, on the confirmation page and the account page alike. The answers are the
 * registry's, this choice deciding a stored field; the question is no stamped word.
 */
export const SPIELER_UMFANG_FRAGE = "Was darf von Deinem Namen auf der Website stehen?";

/** The two publication scopes, both in one list: a control offering one answer and a blank reads as a default. */
export const EINWILLIGUNG_UMFANG_OPTIONS: readonly FLEinwilligungUmfang[] = Object.values(FLEinwilligungUmfang);

// Both bounds, never the floor alone: named for the floor, a mistyped year would answer a
// 190-year-old date with „mindestens 16“, which is a different fault.

// The ceiling is the contact seat's constant, which
// `fl_backend/app/api/registrierungen/services.py :: find_alter_refusal` applies to a pupil too.
export const alterAusserhalb = (mindestalter: number): string =>
  `Du musst mindestens ${String(mindestalter)} und höchstens ${String(BEWERBUNG_MAX_ALTER)} Jahre alt sein.`;
