import z from "zod";

import { BaseAPIResponseSchema } from "@/core/schemas";
import { CustomDateStringSchema, CustomObjectIdStringSchema, FLKontaktSchema, PersonNameSchema } from "@/shared/schemas";

export const FLPostSchiedsrichterPayloadSchema = z.object({
  name: PersonNameSchema,
  default_payment: z.int({ error: "Bitte gib ein Standard-Honorar ein." }).nonnegative({ error: "Das Honorar darf nicht negativ sein." }),
  kontakt: FLKontaktSchema,
  schule: z.string().nullable(),
});
export type FLPostSchiedsrichterPayload = z.infer<typeof FLPostSchiedsrichterPayloadSchema>;

export const FLPatchSchiedsrichterPayloadSchema = z.object({
  id: CustomObjectIdStringSchema,
  name: PersonNameSchema,
  default_payment: z.int({ error: "Bitte gib ein Standard-Honorar ein." }).nonnegative({ error: "Das Honorar darf nicht negativ sein." }),
  kontakt: FLKontaktSchema,
  schule: z.string().nullable(),
});
export type FLPatchSchiedsrichterPayload = z.infer<typeof FLPatchSchiedsrichterPayloadSchema>;

/**
 * Widened at the money field: an emptied box holds `null`, which the schema above refuses at the submit.
 * `Omit`, not a plain intersection -- `T & { default_payment: number | null }` stays assignable to `T`,
 * so the `null` never reaches a caller's view.
 */
export type FLSchiedsrichterPayloadDraft<T extends { default_payment: number }> = Omit<T, "default_payment"> & {
  default_payment: number | null;
};

/** The retire and its reactivate: an id in the path, no request body. */
export const FLSchiedsrichterKeyPayloadSchema = z.object({
  id: CustomObjectIdStringSchema,
});
export type FLSchiedsrichterKeyPayload = z.infer<typeof FLSchiedsrichterKeyPayloadSchema>;

/**
 * The ANONYMISATION's whole argument: the id in the path, no request body. Its own schema, not the
 * reversible pair's key above — a shared payload would let a caller reach the deletion while reading
 * as a retirement.
 */
export const FLAnonymiseSchiedsrichterPayloadSchema = z.object({
  id: CustomObjectIdStringSchema,
});
export type FLAnonymiseSchiedsrichterPayload = z.infer<typeof FLAnonymiseSchiedsrichterPayloadSchema>;

export const FLSchiedsrichterSchema = z.object({
  id: CustomObjectIdStringSchema,

  name: z.string().nonempty(),
  schule: z.string().nullable(),
  // The standard fee. A Spiel's embedded `payment` is what was agreed for that match, and changing
  // this never rewrites it.
  default_payment: z.int().nonnegative(),
  kontakt: FLKontaktSchema,
  // The day the referee was retired, null while they officiate. Deactivation goes through
  // DELETE, so it is on no payload.
  inactive_since: CustomDateStringSchema.nullable(),
});
export type FLSchiedsrichter = z.infer<typeof FLSchiedsrichterSchema>;

export const FLSchiedsrichterListResponseSchema = BaseAPIResponseSchema.extend({
  schiedsrichter: z.array(FLSchiedsrichterSchema),
});
export type FLSchiedsrichterListResponse = z.infer<typeof FLSchiedsrichterListResponseSchema>;

export const FLPostSchiedsrichterResponseSchema = BaseAPIResponseSchema.extend({
  created_id: CustomObjectIdStringSchema,
});
export type FLPostSchiedsrichterResponse = z.infer<typeof FLPostSchiedsrichterResponseSchema>;

export const FLPatchSchiedsrichterResponseSchema = BaseAPIResponseSchema.extend({
  updated_document: FLSchiedsrichterSchema,
  // How many fixtures the rename reached. Reported because the fan-out fails silently (`docs/backend/spec.md :: I13`).
  fanned_out_to_spiele: z.int().nonnegative(),
});
export type FLPatchSchiedsrichterResponse = z.infer<typeof FLPatchSchiedsrichterResponseSchema>;

/**
 * What the retire, the reactivate and the anonymisation echo: one backend model for the three.
 *
 * The anonymisation answers with the referee still standing — cleared `kontakt`, `name` untouched.
 */
export const FLSchiedsrichterWriteResponseSchema = BaseAPIResponseSchema.extend({
  updated_document: FLSchiedsrichterSchema,
});
export type FLSchiedsrichterWriteResponse = z.infer<typeof FLSchiedsrichterWriteResponseSchema>;
