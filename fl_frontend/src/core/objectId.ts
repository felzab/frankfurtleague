/**
 * `core` for `fl_frontend/src/core/emailAddress.ts`'s reason: `eslint.config.mjs :: LAYER_BOUNDARY`
 * refuses `core` an import from `shared`, so a read model declared here could not otherwise validate
 * the id shape its siblings validate.
 */

import z from "zod";

// Named rather than written into the schema below, so `fl_backend/tests/shared/test_frontend_mirrors.py :: UNPAIRABLE_PATTERNS`
// can hold it against the backend's own rule for an id.
const OBJECT_ID_REGEX = /^[0-9a-fA-F]{24}$/;

export const CustomObjectIdStringSchema = z.string().regex(OBJECT_ID_REGEX, {
  // German, as every message a form surfaces is: a failure reaches a `<FieldError>` under a picker rather than a console.
  error: "Bitte wähle den Eintrag erneut aus.",
});
