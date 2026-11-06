import { parseDate } from "@internationalized/date";

import { medienZuJung } from "@/features/account/einwilligung";

import { BEWERBUNG_MAX_ALTER } from "./constants";

// Redesign: goes with its last importers in `features/registrierungen`; `core/format.ts :: bornAfter`, `bornBy` replace it.
/**
 * Bounds rather than an age: a date control takes a `minValue` and a schema a string comparison, so
 * one derivation serves both. The floor is the seat's, which the link's own read answers
 * (`fl_backend/app/api/bewerbungen/schemas.py :: FLBewerbungEinwilligungViewResponse`).
 */
export function geburtsdatumSpanne(today: string, mindestalter: number): { frueheste: string; spaeteste: string } {
  const heute = parseDate(today);

  // The day AFTER one year past the ceiling: `fl_backend/app/shared/age.py :: whole_years_between`
  // accepts a birthday not yet reached this year, and a calendar subtraction clamps 29 February onto
  // the day before 1 March where that year has none.
  return {
    frueheste: heute
      .subtract({ years: BEWERBUNG_MAX_ALTER + 1 })
      .add({ days: 1 })
      .toString(),
    spaeteste: heute.subtract({ years: mindestalter }).toString(),
  };
}

// The switch rather than the date is the repair: each confirmation page offers it from the served age
// on the browser's German day, so only a clock disagreeing with the backend's shows it below that age.
const MEDIEN_AUSSCHALTEN = "Schalte die Erlaubnis aus und bestätige erneut.";

/** A confirmation page's media refusal where the link's view serves no floor to name. */
export const MEDIEN_NOCH_NICHT = `Fotos, Videos und Interviews kannst Du mit diesem Geburtsdatum noch nicht erlauben. ${MEDIEN_AUSSCHALTEN}`;

/** Every confirmation page's media refusal, at the floor its link's view serves, or naming none where it went unread. */
export const medienNochNicht = (medienMindestalter: number | null): string =>
  medienMindestalter === null ? MEDIEN_NOCH_NICHT : `${medienZuJung(medienMindestalter)} ${MEDIEN_AUSSCHALTEN}`;
