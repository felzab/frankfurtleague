import z from "zod";

import { KONTAKT_NAME_MAX_LENGTH, KONTAKT_NAME_ZU_LANG } from "@/features/teams/constants";
import { FLKontaktPayloadSchema, PersonNameSchema } from "@/shared/schemas";

import type { FLKontakt } from "@/core/generated/client/types";

// A whole name held to the ceiling one part of any other person's name takes: one number, and one
// sentence, on every form.
const schiedsrichterName = PersonNameSchema.max(KONTAKT_NAME_MAX_LENGTH, { error: KONTAKT_NAME_ZU_LANG });

// Redesign: goes with its last importer.
export const FLPostSchiedsrichterPayloadSchema = z.object({
  name: schiedsrichterName,
  default_payment: z.int({ error: "Bitte gib ein Standard-Honorar ein." }).nonnegative({ error: "Das Honorar darf nicht negativ sein." }),
  kontakt: FLKontaktPayloadSchema,
  schule: z.string().nullable(),
});
export type FLPostSchiedsrichterPayload = z.infer<typeof FLPostSchiedsrichterPayloadSchema>;

// Redesign: goes with its last importer.
/**
 * Widened at each field whose emptied box holds `null`, which the schema above refuses at the submit. `Omit`, not an intersection: `T & { default_payment: number | null }` stays
 * assignable to `T`, hiding the `null` from every caller.
 */
export type FLSchiedsrichterPayloadDraft<T extends { default_payment: number; kontakt: { email: string } }> = Omit<
  T,
  "default_payment" | "kontakt"
> & {
  default_payment: number | null;
  kontakt: FLKontakt;
};
