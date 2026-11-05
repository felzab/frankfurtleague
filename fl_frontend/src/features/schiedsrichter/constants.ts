import { FLEinwilligungScope } from "@/core/generated/client/types";
import { BEWERBUNG_MAX_ALTER } from "@/features/bewerbungen/constants";
import { PLACEHOLDER } from "@/shared/utils/format";

import type { FLSchiedsrichterConfirmationFristDays } from "@/core/generated/client/types";

// Not a first name, which beside a date and a club still identifies one person in a league this
// size, and not „Schiedsrichter“, which reads oddly in a column already headed with it.
/**
 * What a reader is shown for a fixture booked to the ghost or whose referee's name is withheld. Stored
 * nowhere, so a rewording reaches every surface at once and moves no data.
 */
export const SCHIEDSRICHTER_ANONYM_LABEL = "anonym";

/**
 * The one row an erasure repoints fixtures at, mirroring
 * `fl_backend/app/core/sentinels.py :: GHOST_SCHIEDSRICHTER_ID`. Every admin by-id route answers 404 for
 * it, so nothing reads it back.
 */
export const GHOST_SCHIEDSRICHTER_ID = "000000000000000000000000";

/**
 * What names a row a hand-write left nameless, where the erasure's word above would claim a deletion
 * that never ran. The list's controls and the editor's header say it alike, so one state has one word.
 */
export const SCHIEDSRICHTER_OHNE_NAMEN_LABEL = "Eintrag ohne Namen";

/**
 * The days a referee's link answers, so the dead-link panel and the privacy notice state the day the endpoint refuses
 * on; checked against
 * `fl_backend/app/shared/schemas/bounds.py :: SCHIEDSRICHTER_CONFIRMATION_FRIST_DAYS`, so the backend moving it fails
 * the type check here. Fourteen rather than the registration's seven: this link waits on an adult with no second
 * route in.
 */
export const SCHIEDSRICHTER_BESTAETIGUNG_FRIST_TAGE = 14 satisfies FLSchiedsrichterConfirmationFristDays;

// Both bounds, never the floor alone: named for the floor, a mistyped year would answer a
// 190-year-old date with „mindestens 16“, which is a different fault.

// The pupil's sentence word for word, and NOT the contact seat's: the two public consent pages ask
// one person one question, and `fl_backend/app/shared/age.py` judges both by the same span.
export const alterAusserhalb = (mindestalter: number): string =>
  `Du musst mindestens ${String(mindestalter)} und höchstens ${String(BEWERBUNG_MAX_ALTER)} Jahre alt sein.`;

/** The publication question's answers in the order the chips stand; their words are the stamped label's. */
export const SCHIEDSRICHTER_UMFANG_WERTE: readonly FLEinwilligungScope[] = Object.values(FLEinwilligungScope);

/** A booked referee as a fixture serves one: the public tier serves whether the name may stand, the admin tier the id. */
type GebuchterSchiedsrichter = { schiedsrichter_id?: string; name: string | null; name_is_public?: boolean };

/**
 * **The id and the verdict decide, never the null name alone**: the ghost and a withheld name name nobody, a
 * nameless row a person still in the league, and one word for all three reports a teacher as deleted.
 */
export function bookedSchiedsrichterName({ schiedsrichter_id, name, name_is_public }: GebuchterSchiedsrichter): string {
  if (name !== null) return name;

  // Only an explicit `false`: the admin tier serves no verdict, and its absence read as withheld turns every
  // referee the editor shows „anonym“.
  return schiedsrichter_id === GHOST_SCHIEDSRICHTER_ID || name_is_public === false
    ? SCHIEDSRICHTER_ANONYM_LABEL
    : SCHIEDSRICHTER_OHNE_NAMEN_LABEL;
}

/**
 * The word a FIXTURE's referee cell shows.
 *
 * Its own helper because the obvious spelling reads both absences through one chain —
 * `schiedsrichter?.name ?? PLACEHOLDER.entity` — which falls through to the no-referee placeholder for
 * a fixture that does hold one.
 */
export function spielSchiedsrichterAnzeige(schiedsrichter: GebuchterSchiedsrichter | null): string {
  return schiedsrichter === null ? PLACEHOLDER.entity : bookedSchiedsrichterName(schiedsrichter);
}
