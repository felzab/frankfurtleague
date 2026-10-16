import z from "zod";

import {
  BaseAPIResponseSchema,
  FLSelbstErasureBewerbungSchema,
  FLSelbstErasureRegistrierungSchema,
  FLSelbstErasureSchiedsrichterSchema,
  FLSelbstErasureSitzSchema,
  FLSelbstErasureSpielerSchema,
  FLSubjektResponseSchema,
} from "@/core/schemas";
import { einzeiligerName, FLKontaktRolleSchema } from "@/features/bewerbungen/schemas";
import { ADRESSE_IM_GRUND_REGEX } from "@/features/sperrliste/schemas";
import { addressSchema, CustomObjectIdStringSchema } from "@/shared/schemas";

import { ERASURE_ANLASS_MAX_LENGTH, REFERENZEN_ADRESSEN_MAX } from "./constants";

/**
 * One seat as a seat holder reads it: who holds it and whether they confirmed. No address, telephone or
 * date at any depth, for any seat: a contact person was promised only administrators see their details.
 */
export const FLTeamSitzSchema = z.object({
  rolle: FLKontaktRolleSchema,
  // `null` is an empty slot, which the landing names rather than omits.
  name: z.string().nullable(),
  bestaetigt: z.boolean(),
});
export type FLTeamSitz = z.infer<typeof FLTeamSitzSchema>;

export const FLTeamSitzeResponseSchema = BaseAPIResponseSchema.extend({
  team_id: CustomObjectIdStringSchema,
  saison_id: z.string(),
  sitze: z.array(FLTeamSitzSchema),
});
export type FLTeamSitzeResponse = z.infer<typeof FLTeamSitzeResponseSchema>;

/**
 * The erasure's lookup, held to no address rule as the API's is: a record stored under an older rule
 * stays erasable (`docs/backend/spec.md :: I329`).
 */
const ADRESSE_NACHSCHLAGEN = addressSchema((address) => address.includes("@"));

/** Mirrors `FLErasureAnsichtPayload`: the address the reveal is read for, in the body for the erasure's own reason. */
export const FLErasureAnsichtPayloadSchema = z.object({ email: ADRESSE_NACHSCHLAGEN });
export type FLErasureAnsichtPayload = z.infer<typeof FLErasureAnsichtPayloadSchema>;

/** Mirrors `FLErasurePayload`: the address, and the request the erasure answers, which every log row it files keeps. */
export const FLErasurePayloadSchema = FLErasureAnsichtPayloadSchema.extend({
  // Trimmed before either bound counts it, as the API is, so a box of spaces is refused in German.
  anlass: einzeiligerName(
    z
      .string({ error: "Bitte gib einen Anlass ein." })
      .trim()
      .nonempty({ error: "Bitte gib einen Anlass ein." })
      .max(ERASURE_ANLASS_MAX_LENGTH, { error: `Der Anlass darf höchstens ${String(ERASURE_ANLASS_MAX_LENGTH)} Zeichen lang sein.` }),
    "Der Anlass",
  )
    // The log row outlives the erasure by a year, and no redaction reaches its `anlass`.
    .refine((anlass) => !ADRESSE_IM_GRUND_REGEX.test(anlass), { error: "Der Anlass darf keine E-Mail-Adresse enthalten." }),
});
export type FLErasurePayload = z.infer<typeof FLErasurePayloadSchema>;

/** Mirrors `FLAbmeldungPayload`: the address whose sessions end, looked up as the erasure looks one up. */
export const FLAbmeldungPayloadSchema = z.object({ email: ADRESSE_NACHSCHLAGEN });
export type FLAbmeldungPayload = z.infer<typeof FLAbmeldungPayloadSchema>;

/** Mirrors `FLAbmeldungResponse`: the envelope alone, the log row it filed naming no address to answer with. */
export const FLAbmeldungResponseSchema = BaseAPIResponseSchema;

/* The reveal's items are the person's own reveal's, each widened by the ids and seasons the administrator's
   links need: one declaration of what a record is named by. */

/** One squad row of a pupil the erasure reaches. */
export const FLErasureAnsichtKaderSchema = z.object({
  saison_id: z.string(),
  team_id: CustomObjectIdStringSchema,
  // Null where no season row names the team.
  team_name: z.string().nullable(),
});

export const FLErasureAnsichtSpielerSchema = FLSelbstErasureSpielerSchema.extend({
  spieler_id: CustomObjectIdStringSchema,
  kader: z.array(FLErasureAnsichtKaderSchema),
});

export const FLErasureAnsichtSchiedsrichterSchema = FLSelbstErasureSchiedsrichterSchema.extend({
  schiedsrichter_id: CustomObjectIdStringSchema,
});

export const FLErasureAnsichtSitzSchema = FLSelbstErasureSitzSchema.extend({ team_id: CustomObjectIdStringSchema });

export const FLErasureAnsichtBewerbungSchema = FLSelbstErasureBewerbungSchema.extend({ bewerbung_id: CustomObjectIdStringSchema });

export const FLErasureAnsichtRegistrierungSchema = FLSelbstErasureRegistrierungSchema.extend({
  registrierung_id: CustomObjectIdStringSchema,
  team_id: CustomObjectIdStringSchema,
});

/** A referee row holding a change to the address still to be confirmed, which names no person to show. */
export const FLErasureAnsichtAdresswechselSchema = z.object({ schiedsrichter_id: CustomObjectIdStringSchema });

/** A pupil row holding a change to the address still to be confirmed, as the referee's above. */
export const FLErasureAnsichtSpielerAdresswechselSchema = z.object({ spieler_id: CustomObjectIdStringSchema });

/**
 * Mirrors `FLErasureAnsichtResponse`: every record the erasure would reach, by kind, name and id, and never the
 * address or a birthdate.
 */
export const FLErasureAnsichtResponseSchema = BaseAPIResponseSchema.extend({
  spieler: z.array(FLErasureAnsichtSpielerSchema),
  schiedsrichter: z.array(FLErasureAnsichtSchiedsrichterSchema),
  sitze: z.array(FLErasureAnsichtSitzSchema),
  bewerbungen: z.array(FLErasureAnsichtBewerbungSchema),
  registrierungen: z.array(FLErasureAnsichtRegistrierungSchema),
  adresswechsel: z.array(FLErasureAnsichtAdresswechselSchema),
  spieler_adresswechsel: z.array(FLErasureAnsichtSpielerAdresswechselSchema),
  verwaltung: FLSubjektResponseSchema.shape.verwaltung,
});
export type FLErasureAnsichtResponse = z.infer<typeof FLErasureAnsichtResponseSchema>;

export const FLReferenzenPayloadSchema = z.object({
  // Each one as the sign-in store holds it, held to no address rule: one refused would refuse the batch.
  identifiers: z.array(z.string()).min(1).max(REFERENZEN_ADRESSEN_MAX),
});
export type FLReferenzenPayload = z.infer<typeof FLReferenzenPayloadSchema>;

export const FLReferenzenResponseSchema = BaseAPIResponseSchema.extend({
  unreferenziert: z.array(z.string()),
});
export type FLReferenzenResponse = z.infer<typeof FLReferenzenResponseSchema>;
