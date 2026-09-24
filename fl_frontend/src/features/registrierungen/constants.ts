import { BEWERBUNG_MAX_ALTER } from "@/features/bewerbungen/constants";

/**
 * The pupil's confirmation deadline, mirrored from `fl_backend/app/shared/schemas/bounds.py`.
 *
 * Shorter than the application's fourteen because it carries a second job: it is the window inside
 * which a mistyped address is discovered.
 */
export const REGISTRIERUNG_BESTAETIGUNG_FRIST_TAGE = 7;

// A reminder does not move the deadline, so this is the day a second message goes out and never a
// second clock. Mirrored from `fl_backend/app/shared/schemas/bounds.py`.
export const REGISTRIERUNG_ERINNERUNG_TAGE = 3;

// Retyped from `fl_backend/app/shared/schemas/bounds.py` for the published notice, which states the
// floor with no answer to read it off. The form still takes the served `mindestalter` below: a page
// judging a date against this copy would refuse where the endpoint accepts.
export const REGISTRIERUNG_MIN_ALTER = 16;

// Retyped from `fl_backend/app/shared/schemas/bounds.py` for the published notice as well, which
// states the media floor for pupils and referees alike; the pages take the served
// `medien_mindestalter` for the reason given above.
export const MEDIEN_MIN_ALTER = 18;

/**
 * The two publication scopes, paired with `fl_backend/app/core/constraints.py :: _EINWILLIGUNG_UMFANG`.
 *
 * Both stand in one list: a control offering one answer and a blank reads as a default.
 */
export const EINWILLIGUNG_UMFANG_OPTIONS = ["kader_oeffentlich", "intern"] as const;

// Both bounds, never the floor alone: named for the floor, a mistyped year would answer a
// 190-year-old date with „mindestens 16“, which is a different fault.

// The ceiling is the contact seat's constant, which
// `fl_backend/app/api/registrierungen/services.py :: find_alter_refusal` applies to a pupil too.
export const alterAusserhalb = (mindestalter: number): string =>
  `Du musst mindestens ${String(mindestalter)} und höchstens ${String(BEWERBUNG_MAX_ALTER)} Jahre alt sein. Prüfe Dein Geburtsdatum.`;
