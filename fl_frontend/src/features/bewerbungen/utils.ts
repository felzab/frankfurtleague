import { parseDate } from "@internationalized/date";

import { mediaTooYoung } from "@/features/account/einwilligung";

import { BEWERBUNG_MAX_AGE } from "./constants";

// Redesign: goes with its last importers in `features/registrierungen`; `core/format.ts :: bornAfter`, `bornBy` replace it.
/**
 * Bounds rather than an age: a date control takes a `minValue` and a schema a string comparison, so
 * one derivation serves both. The floor is the seat's, which the link's own read answers
 * (`fl_backend/app/api/bewerbungen/schemas.py :: FLBewerbungEinwilligungViewResponse`).
 */
export function birthDateSpan(today: string, mindestalter: number): { earliest: string; latest: string } {
  const heute = parseDate(today);

  // The day AFTER one year past the ceiling: `fl_backend/app/shared/age.py :: whole_years_between`
  // accepts a birthday not yet reached this year, and a calendar subtraction clamps 29 February onto
  // the day before 1 March where that year has none.
  return {
    earliest: heute
      .subtract({ years: BEWERBUNG_MAX_AGE + 1 })
      .add({ days: 1 })
      .toString(),
    latest: heute.subtract({ years: mindestalter }).toString(),
  };
}

// The switch rather than the date is the repair: each confirmation page offers it from the served age
// on the browser's German day, so only a clock disagreeing with the backend's shows it below that age.
const MEDIA_SWITCH_OFF = "Schalte die Erlaubnis aus und bestätige erneut.";

/** A confirmation page's media refusal where the link's view serves no floor to name. */
export const MEDIA_NOT_YET = `Fotos, Videos und Interviews kannst Du mit diesem Geburtsdatum noch nicht erlauben. ${MEDIA_SWITCH_OFF}`;

/** Every confirmation page's media refusal, at the floor its link's view serves, or naming none where it went unread. */
export const mediaNotYet = (mediaMinimumAge: number | null): string =>
  mediaMinimumAge === null ? MEDIA_NOT_YET : `${mediaTooYoung(mediaMinimumAge)} ${MEDIA_SWITCH_OFF}`;
