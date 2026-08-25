import z from "zod";

import { BaseAPIResponseSchema } from "@/core/schemas";
import { CustomObjectIdStringSchema } from "@/shared/schemas";

export const FLAktorSchema = z.object({
  kind: z.enum(["admin_session", "system"]),
  email: z.string(),
});
export type FLAktor = z.infer<typeof FLAktorSchema>;

export const FLAktionRequestSchema = z.object({
  method: z.string(),
  path: z.string(),
});
export type FLAktionRequest = z.infer<typeof FLAktionRequestSchema>;

/**
 * One recorded write. **Every field is exactly as wide as the backend's and no wider** — this collection holds copies of
 * documents from every other one, so a mirror refusing a single stored value takes the whole page down with it.
 */
export const FLAktionSchema = z.object({
  id: CustomObjectIdStringSchema,
  // Not `CustomDateStringSchema`: an instant carrying an offset, where every other date in this app is a calendar day.
  at: z.string(),
  actor: FLAktorSchema,
  correlation_id: z.string(),
  // Null on a write made outside a request, which is what the system actor records.
  request: FLAktionRequestSchema.nullable(),
  // Open rather than an enum of the nine names: a collection added on the backend must still list here.
  collection: z.string(),
  operation: z.enum(["insert", "insert_many", "patch_one", "patch_many", "delete_many", "erase_many"]),
  // An ObjectId everywhere but `saisons`, whose id is the season string. Null on a fan-out, which named a filter
  // instead, and on a bulk create, which named nothing at all (`docs/backend/spec.md :: I40`).
  document_id: z.string().nullable(),
  db_filter: z.record(z.string(), z.string()).nullable(),
  // The replaced document, in whatever shape its own collection gives it. An array is a removal's,
  // which took a set and holds every image it removed (`docs/backend/spec.md :: I47`).
  before: z.union([z.record(z.string(), z.unknown()), z.array(z.record(z.string(), z.unknown()))]).nullable(),
  modified_count: z.int().nullable(),
  // Set once a person's erasure has overwritten the values this row recorded.
  redacted_at: z.string().nullable(),
});
export type FLAktion = z.infer<typeof FLAktionSchema>;

export const FLAktionenListResponseSchema = BaseAPIResponseSchema.extend({
  aktionen: z.array(FLAktionSchema),
});
export type FLAktionenListResponse = z.infer<typeof FLAktionenListResponseSchema>;
