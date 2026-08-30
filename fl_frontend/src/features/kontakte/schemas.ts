import z from "zod";

import { BaseAPIResponseSchema } from "@/core/schemas";
import { FLSaisonTeamKontaktePayloadSchema, FLSaisonTeamKontakteSchema } from "@/features/teams/schemas";
import { CustomObjectIdStringSchema, KONTAKT_EMAIL_MAX_LENGTH } from "@/shared/schemas";

/**
 * The address IS the identity: nothing joins one season's Trainer to the next, so the request names
 * a person and not a row. Its own declaration, so no value typed for a write reaches the deletion.
 */
export const FLKontaktErasurePayloadSchema = z.object({
  // Spelled as the team editor spells it: the backend types the field the same way, and its refusal
  // carries no field detail, so an address only the server judged would mark no box.
  email: z
    .email({ error: "Bitte gib eine gültige E-Mail-Adresse ein." })
    .max(KONTAKT_EMAIL_MAX_LENGTH, { error: `Die E-Mail-Adresse darf höchstens ${String(KONTAKT_EMAIL_MAX_LENGTH)} Zeichen lang sein.` }),
});
export type FLKontaktErasurePayload = z.infer<typeof FLKontaktErasurePayloadSchema>;

/**
 * Mirrors `FLKontaktErasureResponse` — counts alone, and deliberately no echo of the person. The
 * request named an address, so answering with anything of theirs would hand back a fresh copy of
 * exactly what the request destroyed.
 */
export const FLKontaktErasureResponseSchema = BaseAPIResponseSchema.extend({
  cleared_saison_teams: z.int().nonnegative(),
  cleared_bewerbungen: z.int().nonnegative(),
  /**
   * The slots actually nulled, across both collections. Higher than the two row counts wherever
   * `trainer_ist_zugleich` seated one person twice in one row, which is what makes this the
   * figure the report counts contact entries by.
   */
  cleared_kontakt_slots: z.int().nonnegative(),
  /** Log rows whose image was emptied and stamped. Never a deletion count: no row is dropped. */
  redacted_aktionen: z.int().nonnegative(),
});
export type FLKontaktErasureResponse = z.infer<typeof FLKontaktErasureResponseSchema>;

/**
 * Mirrors `FLPatchSaisonTeamKontaktePayload` — the three seats alone, on the row the path names.
 * `FLSaisonTeamKontaktePayloadSchema` is reused: the junction PATCH takes the same block, and a
 * second spelling would drift with nothing able to see it.
 */
export const FLPatchSaisonTeamKontaktePayloadSchema = z.object({
  // Both ids are in the PATH on the wire — the junction row is addressed by its natural key. They
  // are carried here because the form has to know which club's season it is writing.
  team_id: CustomObjectIdStringSchema,
  saison_id: z.string().length(4, { error: "Die Saison-ID besteht aus genau 4 Zeichen." }),
  // The whole block, or `null` to clear it. REQUIRED with no default: a form that omits it gets a
  // 422, never three people quietly left standing.
  kontakte: FLSaisonTeamKontaktePayloadSchema.nullable(),
});
export type FLPatchSaisonTeamKontaktePayload = z.infer<typeof FLPatchSaisonTeamKontaktePayloadSchema>;

/**
 * Mirrors `FLPatchSaisonTeamKontakteResponse` — the block as stored after the write, and no other
 * field of the row. The endpoint answers about the seats it moved, so the group and the Austritt
 * beside them are not its to echo.
 */
export const FLPatchSaisonTeamKontakteResponseSchema = BaseAPIResponseSchema.extend({
  saison_id: z.string(),
  team_id: CustomObjectIdStringSchema,
  kontakte: FLSaisonTeamKontakteSchema.nullable(),
});
export type FLPatchSaisonTeamKontakteResponse = z.infer<typeof FLPatchSaisonTeamKontakteResponseSchema>;
