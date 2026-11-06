// Redesign: goes with its last importer.
import z from "zod";

import { FLKontaktRolle } from "@/core/generated/client/types";
import { KONTAKT_NAME_MAX_LENGTH, KONTAKT_NAME_ZU_LANG } from "@/features/teams/constants";
import { FLGruppenNamesSchema, FLTrikotFarbeSchema } from "@/features/teams/schemas";
import { CustomObjectIdStringSchema, KontaktEmailSchema, PersonNameSchema, PHONE_REGEX } from "@/shared/schemas";

import { BEWERBUNG_DECISION_REASON_MAX_LENGTH } from "./constants";

/**
 * The acceptance's input. No `saison_id`: the application names its own season, so a payload carrying
 * one could only disagree with it.
 */
export const FLAnnehmenBewerbungPayloadSchema = z.object({
  id: CustomObjectIdStringSchema,
  gruppe: FLGruppenNamesSchema,
  // Assigned rather than read off `trikot.wunschfarbe`: a wish is not an assignment.
  trikot_farbe: FLTrikotFarbeSchema.nullable(),
  shorthand: z.string().nullable(),
  version: z.number(),
});

/**
 * The decline's input. Its own declaration and never shared with the acceptance's: the two are not
 * inverses, and a payload reaching both would let a value typed for one arrive at the other.
 */
export const FLAblehnenBewerbungPayloadSchema = z.object({
  id: CustomObjectIdStringSchema,
  // Required and non-empty: it is stored on the application AND sent to the people who applied, so a
  // decline with nothing to say is one nobody can act on.
  reason: z
    .string()
    // Trimmed before it is measured, and the trimmed value is what the write carries: „   “ is an
    // empty reason, and a decline is stored and mailed once with no way back.
    .trim()
    .nonempty({ error: "Bitte gib einen Grund für die Absage an." })
    .max(BEWERBUNG_DECISION_REASON_MAX_LENGTH, {
      error: `Der Grund darf höchstens ${String(BEWERBUNG_DECISION_REASON_MAX_LENGTH)} Zeichen lang sein.`,
    }),
  version: z.number(),
});

/** The wire names a seat by this closed set; an input naming another is refused before it is sent. */
const FLKontaktRolleSchema = z.enum(FLKontaktRolle, {
  error: "Diese Rolle gibt es in einer Bewerbung nicht.",
});

/** Which application and which of its seats. Both travel in the path, so the request carries no body at all. */
export const FLEinwilligungErneutPayloadSchema = z.object({
  id: CustomObjectIdStringSchema,
  rolle: FLKontaktRolleSchema,
});

/**
 * The one field of a submitted application an administrator may rewrite. `id` and `rolle` travel in
 * the path, as the re-send's do.
 */
export const FLBewerbungKontaktEmailPayloadSchema = z.object({
  id: CustomObjectIdStringSchema,
  rolle: FLKontaktRolleSchema,
  email: KontaktEmailSchema,
  version: z.number(),
});

/**
 * The person seated where a contact person stepped out. The four fields are restated rather than taken
 * off the submission's seat: that one carries the Kenntnisnahme, which this person has given nobody.
 */
export const FLBewerbungKontaktSitzPayloadSchema = z.object({
  id: CustomObjectIdStringSchema,
  rolle: FLKontaktRolleSchema,
  first_name: PersonNameSchema.max(KONTAKT_NAME_MAX_LENGTH, { error: KONTAKT_NAME_ZU_LANG }),
  last_name: PersonNameSchema.max(KONTAKT_NAME_MAX_LENGTH, { error: KONTAKT_NAME_ZU_LANG }),
  email: KontaktEmailSchema,
  phone: z.string().regex(PHONE_REGEX, { error: "Bitte gib eine gültige Telefonnummer ein." }),
  version: z.number(),
});
