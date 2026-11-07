// Redesign: goes with its last importer.
import z from "zod";

import { BAN_REASON_MAX_LENGTH } from "@/features/sperrliste/constants";
import { CustomObjectIdStringSchema, KontaktEmailSchema, singleLineName } from "@/shared/schemas";

/**
 * Unanchored, character for character `fl_backend/app/api/ban_list/schemas.py ::
 * ADDRESS_IN_FREE_TEXT`: both ends SEARCH a sentence rather than matching one, which is why
 * keeping the two equal is by hand.
 */
export const ADRESSE_IM_GRUND_REGEX = /[^\s@]+@[^\s@]+\.[A-Za-z]{2,}/;

/** The create dialog's draft, held to the ban's own rules in German: the browser checks it before the press. */
export const FLPostBanListEntryPayloadSchema = z.object({
  // `KontaktEmailSchema` and never `z.email()`, whose alphabet refuses atext characters the API
  // takes: an address this turned away is one that would never have been banned.
  email: KontaktEmailSchema,
  // Trimmed before any bound counts it, as at the API, which refuses a blank reason, one over the
  // ceiling and one holding a line break with a generic `payload_refused` sentence: a looser draft
  // loses each bound's German.
  ban_reason: singleLineName(
    z
      .string()
      .trim()
      .nonempty({ error: "Bitte gib einen Grund ein." })
      .max(BAN_REASON_MAX_LENGTH, { error: `Der Grund darf höchstens ${String(BAN_REASON_MAX_LENGTH)} Zeichen lang sein.` }),
    "Der Grund",
  )
    // The reason is served, copied whole into a removal's action-log image, and outlives the
    // person's erasure, so an address typed here survives everywhere the stored hash keeps one out.
    .refine((grund) => !ADRESSE_IM_GRUND_REGEX.test(grund), { error: "Der Grund darf keine E-Mail-Adresse enthalten." }),
});
/** What the dialog sends: the address and the reason, never whether it is told, which the server's own store answers. */
export type SperreEntwurf = z.infer<typeof FLPostBanListEntryPayloadSchema>;

/** The removal's input: the ban the row names, which the call puts in its path. */
export const FLBanListEntryKeyPayloadSchema = z.object({
  id: CustomObjectIdStringSchema,
});
export type FLBanListEntryKeyPayload = z.infer<typeof FLBanListEntryKeyPayloadSchema>;
