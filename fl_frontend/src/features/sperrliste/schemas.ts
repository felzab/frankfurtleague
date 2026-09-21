import z from "zod";

import { BaseAPIResponseSchema } from "@/core/schemas";
import { SPERRLISTE_GRUND_MAX_LENGTH } from "@/features/sperrliste/constants";
import { CustomDateStringSchema, CustomObjectIdStringSchema, KontaktEmailSchema } from "@/shared/schemas";

/**
 * One ban, as the API serves it. **No address field, and none can be added**: the collection keeps a
 * keyed hash and every response is built to hold no key carrying an `@`.
 */
export const FLSperrlisteEintragSchema = z.object({
  id: CustomObjectIdStringSchema,
  grund: z.string().nonempty(),
  // Judged on the payload alone: a read stating an address rule refuses a value the API stored, and
  // one such row fails the whole list's parse.
  erstellt_von: z.string().nonempty(),
  erstellt_am: CustomDateStringSchema,
});
export type FLSperrlisteEintrag = z.infer<typeof FLSperrlisteEintragSchema>;

export const FLSperrlisteListResponseSchema = BaseAPIResponseSchema.extend({
  sperrliste: z.array(FLSperrlisteEintragSchema),
  /**
   * How many bans the collection holds, which the rows cannot answer once the endpoint's cap has cut
   * them short. Past that cap a ban is enforced and shown to nobody, so nobody can lift it either.
   */
  anzahl_gesamt: z.int().nonnegative(),
});
export type FLSperrlisteListResponse = z.infer<typeof FLSperrlisteListResponseSchema>;

/**
 * Unanchored, character for character `fl_backend/app/api/sperrliste/schemas.py ::
 * ADDRESS_IN_FREE_TEXT`: both ends SEARCH a sentence rather than matching one, which is why
 * `fl_backend/tests/shared/test_frontend_mirrors.py :: UNPAIRABLE_PATTERNS` records the pair
 * instead of comparing it, and why keeping the two equal is by hand.
 */
export const ADRESSE_IM_GRUND_REGEX = /[^\s@]+@[^\s@]+\.[A-Za-z]{2,}/;

export const FLPostSperrlistePayloadSchema = z.object({
  // `KontaktEmailSchema` and never `z.email()`, whose alphabet refuses the umlaut local part
  // `EmailStr` takes: an address this turned away is one that would never have been banned.
  email: KontaktEmailSchema,
  // Trimmed before either bound counts it, as the API is: it refuses a reason of spaces alone, and
  // one over the ceiling, with a bare `REQ-VAL-001` carrying no field detail, so a looser mirror
  // marks no box.
  grund: z
    .string()
    .trim()
    .nonempty({ error: "Bitte gib einen Grund ein." })
    .max(SPERRLISTE_GRUND_MAX_LENGTH, { error: `Der Grund darf höchstens ${String(SPERRLISTE_GRUND_MAX_LENGTH)} Zeichen lang sein.` })
    // The reason is served, copied whole into a removal's action-log image, and outlives the
    // person's erasure, so an address typed here survives everywhere the stored hash keeps one out.
    .refine((grund) => !ADRESSE_IM_GRUND_REGEX.test(grund), { error: "Der Grund darf keine E-Mail-Adresse enthalten." }),
});
export type FLPostSperrlistePayload = z.infer<typeof FLPostSperrlistePayloadSchema>;

export const FLPostSperrlisteResponseSchema = BaseAPIResponseSchema.extend({
  created_id: CustomObjectIdStringSchema,
});
export type FLPostSperrlisteResponse = z.infer<typeof FLPostSperrlisteResponseSchema>;

/** The removal call: an id in the path, no request body. */
export const FLSperrlisteKeyPayloadSchema = z.object({
  id: CustomObjectIdStringSchema,
});
export type FLSperrlisteKeyPayload = z.infer<typeof FLSperrlisteKeyPayloadSchema>;

/** The removal echoes the id rather than the row: the delete is hard, so no document is left to send. */
export const FLSperrlisteWriteResponseSchema = BaseAPIResponseSchema.extend({
  sperrliste_id: CustomObjectIdStringSchema,
});
export type FLSperrlisteWriteResponse = z.infer<typeof FLSperrlisteWriteResponseSchema>;
