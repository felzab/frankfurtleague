// Redesign: goes with its last importer.
import z from "zod";

import { SPERRLISTE_GRUND_MAX_LENGTH } from "@/features/sperrliste/constants";
import { CustomObjectIdStringSchema, einzeiligerName, KontaktEmailSchema } from "@/shared/schemas";

/**
 * Unanchored, character for character `fl_backend/app/api/sperrliste/schemas.py ::
 * ADDRESS_IN_FREE_TEXT`: both ends SEARCH a sentence rather than matching one, which is why
 * keeping the two equal is by hand.
 */
export const ADRESSE_IM_GRUND_REGEX = /[^\s@]+@[^\s@]+\.[A-Za-z]{2,}/;

/** The create dialog's draft, held to the ban's own rules in German: the browser checks it before the press. */
export const FLPostSperrlistePayloadSchema = z.object({
  // `KontaktEmailSchema` and never `z.email()`, whose alphabet refuses the umlaut domain the API
  // converts: an address this turned away is one that would never have been banned.
  email: KontaktEmailSchema,
  // Trimmed before any bound counts it, as at the API, which refuses a blank reason, one over the
  // ceiling and one holding a line break with a generic `payload_refused` sentence: a looser draft
  // loses each bound's German.
  grund: einzeiligerName(
    z
      .string()
      .trim()
      .nonempty({ error: "Bitte gib einen Grund ein." })
      .max(SPERRLISTE_GRUND_MAX_LENGTH, { error: `Der Grund darf höchstens ${String(SPERRLISTE_GRUND_MAX_LENGTH)} Zeichen lang sein.` }),
    "Der Grund",
  )
    // The reason is served, copied whole into a removal's action-log image, and outlives the
    // person's erasure, so an address typed here survives everywhere the stored hash keeps one out.
    .refine((grund) => !ADRESSE_IM_GRUND_REGEX.test(grund), { error: "Der Grund darf keine E-Mail-Adresse enthalten." }),
});
/** What the dialog sends: the address and the reason, never whether it is told, which the server's own store answers. */
export type SperreEntwurf = z.infer<typeof FLPostSperrlistePayloadSchema>;

/** The removal's input: the ban the row names, which the call puts in its path. */
export const FLSperrlisteKeyPayloadSchema = z.object({
  id: CustomObjectIdStringSchema,
});
export type FLSperrlisteKeyPayload = z.infer<typeof FLSperrlisteKeyPayloadSchema>;
