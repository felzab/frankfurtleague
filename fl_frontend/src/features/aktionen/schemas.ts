import z from "zod";

import { BaseAPIResponseSchema } from "@/core/schemas";
import { CustomObjectIdStringSchema } from "@/shared/schemas";

export const FLAktorMitAdresseSchema = z.object({
  // `public` is a visitor with no session at all — the application form's own write. `email` is a
  // mailbox for `admin_session` alone, and a sentinel for the other two.
  kind: z.enum(["admin_session", "system", "public"]),
  email: z.string(),
});

/** A signed-in person, named by a pseudonym and the Funktion the write was authorised under, and never by an address. */
export const FLAktorPersonSchema = z.object({
  kind: z.enum(["person_session"]),
  pseudonym: z.string(),
  funktion: z.enum(["kontakt", "spieler", "schiedsrichter"]),
});
export type FLAktorPerson = z.infer<typeof FLAktorPersonSchema>;

/** On `kind`, so a person's row can never be read as carrying an address. */
export const FLAktorSchema = z.discriminatedUnion("kind", [FLAktorMitAdresseSchema, FLAktorPersonSchema]);
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
  trace_id: z.string(),
  // Null on a write made outside a request, which is what the system actor records.
  request: FLAktionRequestSchema.nullable(),
  // Open rather than an enum of the recorded names: a collection added on the backend must still list here.
  collection: z.string(),
  operation: z.enum(["insert", "insert_many", "patch_one", "patch_many", "delete_many", "erase_many"]),
  // An ObjectId everywhere but `saisons`, whose id is the season string. Null on a fan-out, which named a filter
  // instead, and on a bulk create, which named nothing at all (`docs/backend/spec.md :: I40`).
  document_id: z.string().nullable(),
  db_filter: z.record(z.string(), z.string()).nullable(),
  // In the replaced document's place: the list never carries an image, only whether the row secured
  // one — `GET /aktionen/{aktion_id}` is the read that serves it (`docs/backend/spec.md :: I43`).
  stand_gesichert: z.boolean(),
  modified_count: z.int().nullable(),
  // Set once a person's erasure, or a referee's anonymisation, has overwritten the values this row recorded.
  redacted_at: z.string().nullable(),
});
export type FLAktion = z.infer<typeof FLAktionSchema>;

export const FLAktionenListResponseSchema = BaseAPIResponseSchema.extend({
  aktionen: z.array(FLAktionSchema),
  /** False where the endpoint's cap cut the answer short — and a year of recorded writes reaches that cap without a flood. */
  vollstaendig: z.boolean(),
  /**
   * Open keys: a stored value no option names would take the page down rather than going uncounted, and an absent
   * key reads as zero. Counted over the rows a trace or document narrowing leaves, never the whole log.
   */
  anzahl_je_collection: z.record(z.string(), z.int().nonnegative()),
  anzahl_je_operation: z.record(z.string(), z.int().nonnegative()),
  anzahl_je_herkunft: z.record(z.string(), z.int().nonnegative()),
});
export type FLAktionenListResponse = z.infer<typeof FLAktionenListResponseSchema>;
