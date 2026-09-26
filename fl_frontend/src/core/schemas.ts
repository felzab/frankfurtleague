import z from "zod";

import { CustomObjectIdStringSchema } from "./objectId";

/**
 * The envelope every FastAPI response carries, mirroring the backend's `BaseAPIResponse`.
 *
 * Not in `api.ts`: that module is `server-only`, and every feature `schemas.ts` value-imports this
 * envelope, which would taint them all.
 */
export const BaseAPIResponseSchema = z.object({ acknowledged: z.literal([0, 1]) });
export type BaseAPIResponse = z.infer<typeof BaseAPIResponseSchema>;

/** Every failure's body, mirroring the backend's `FLFailureBody` (`docs/logging/spec.md :: L4`). */
export const FLFailureBodySchema = z.object({ error_code: z.string(), trace_id: z.string() });

/** One refusal a `REQ-VAL-001` names; `kind` is pydantic's error `type`. */
export const FLRefusedFieldSchema = z.object({
  in: z.enum(["body", "query", "path", "header", "cookie"]),
  path: z.array(z.union([z.string(), z.number().int()])),
  kind: z.string(),
});
export type FLRefusedField = z.infer<typeof FLRefusedFieldSchema>;

export const FLRefusedPayloadBodySchema = FLFailureBodySchema.extend({ fields: z.array(FLRefusedFieldSchema) });

/**
 * Which mailbox `POST /identitaet/subjekt` is asked about, folded
 * (`fl_frontend/src/core/emailAddress.ts :: asSignInIdentifier`). No length or alphabet is restated
 * here: `core` may not import `fl_frontend/src/shared/schemas.ts`
 * (`fl_frontend/eslint.config.mjs :: LAYER_BOUNDARY`), and a second copy would drift unwatched.
 */
export const FLSubjektPayloadSchema = z.object({ email: z.string() });
export type FLSubjektPayload = z.infer<typeof FLSubjektPayloadSchema>;

/**
 * One contact seat the mailbox holds on a `saison_teams` row, per seat rather than per person: one
 * junction row seats one person twice where `trainer_ist_zugleich` says so.
 */
export const FLSubjektSitzSchema = z.object({
  saison_id: z.string(),
  team_id: CustomObjectIdStringSchema,
  // The contact-seat sense of the word, never the captaincy's
  // (`fl_backend/app/api/bewerbungen/schemas.py :: FLKontaktRolle`).
  rolle: z.enum(["trainer", "ansprechperson", "stellvertretung"]),
  // The name the club was PLAYED under, never the one it carries now
  // (`docs/backend/spec.md :: I13`).
  team_name: z.string(),
  saison_status: z.enum(["past", "active", "future"]),
});
export type FLSubjektSitz = z.infer<typeof FLSubjektSitzSchema>;

/** One pupil record the mailbox names, the id alone: the caller composed the address it asked about. */
export const FLSubjektSpielerSchema = z.object({ spieler_id: CustomObjectIdStringSchema });
export type FLSubjektSpieler = z.infer<typeof FLSubjektSpielerSchema>;

/** One referee record the mailbox names, carrying the id alone for `FLSubjektSpielerSchema`'s reason. */
export const FLSubjektSchiedsrichterSchema = z.object({ schiedsrichter_id: CustomObjectIdStringSchema });
export type FLSubjektSchiedsrichter = z.infer<typeof FLSubjektSchiedsrichterSchema>;

/**
 * Which confirmed, live league records one mailbox matches. A list under each rather than an
 * optional record: one inbox holds seats at two clubs, and two pupils share an address
 * (`docs/datenschutz.md`).
 */
export const FLSubjektResponseSchema = BaseAPIResponseSchema.extend({
  sitze: z.array(FLSubjektSitzSchema),
  spieler: z.array(FLSubjektSpielerSchema),
  schiedsrichter: z.array(FLSubjektSchiedsrichterSchema),
  // Read beside the lists and never from their being empty: empty lists with this set are a person
  // one confirmation from holding their records, not a mailbox the league holds nothing for
  // (`docs/backend/spec.md :: I374`).
  unbestaetigt: z.boolean(),
});
export type FLSubjektResponse = z.infer<typeof FLSubjektResponseSchema>;
