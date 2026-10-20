/** One choice's evidence as the person's own confirmation stamps it. */
const BESTAETIGUNG = { am: "2026-09-01T10:00:00Z", text_version: "2026-09-spielerseite", erteilt_zuvor: null } as const;

/**
 * A pupil's record as their own confirmation writes it, each choice evidenced: every person is born
 * of one. Untyped for `fl_frontend/src/shared/testing/selbstFixtures.ts`'s reason, `as const` keeping
 * its literals.
 */
export const bestaetigteEinwilligung = () =>
  ({
    umfang: "kader_oeffentlich",
    datum: "2026-09-01",
    bestaetigt_am: "2026-09-01",
    text_version: "2026-09-spielerseite",
    medien: false,
    nachweis: { umfang: BESTAETIGUNG, medien: BESTAETIGUNG },
  }) as const;
