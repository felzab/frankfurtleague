import z from "zod";

import { BaseAPIResponseSchema } from "@/core/schemas";
import { FLKontaktRolleSchema } from "@/features/bewerbungen/schemas";
import { FLSchiedsrichterSelbstSchema } from "@/features/schiedsrichter/schemas";
import {
  FLEinwilligungSchema,
  FLEinwilligungStandSchema,
  FLSpielerKontextSchema,
  FLSpielerPositionSchema,
  FLSpielerSelbstSchema,
  FLSpielerStufeSchema,
} from "@/features/spieler/schemas";
import { FLKontaktKenntnisnahmeSchema } from "@/features/teams/schemas";
import { CustomDateStringSchema, CustomObjectIdStringSchema } from "@/shared/schemas";

/**
 * Mirrors `FLSitzKontext`: what a seat's confirmation page fills its slots with. `schule` is the field
 * as served, whatever that seat's page named its school by, and never derived here.
 */
export const FLSitzKontextSchema = z.object({
  vorname: z.string().nullable(),
  team: z.string(),
  schule: z.string().nullable(),
  saison: z.string(),
});
export type FLSitzKontext = z.infer<typeof FLSitzKontextSchema>;

/**
 * Mirrors `FLKontoSitzEinwilligung`: one entry per team season, however many of its seats the person
 * holds, because one press moves both choices on every one of them.
 */
export const FLKontoSitzEinwilligungSchema = z.object({
  team_id: CustomObjectIdStringSchema,
  team_name: z.string(),
  saison_id: z.string(),
  rollen: z.array(FLKontaktRolleSchema).nonempty(),
  // The label whose words the account page shows beside the control: the backend names which stored
  // label the person confirmed, so the page never decides it from the record's shape.
  bestaetigt_text_version: z.string().nullable(),
  umfang: FLKontaktKenntnisnahmeSchema.shape.umfang,
  medien: z.boolean(),
  // The consent press's precondition, for the reason `FLSpielerSelbstSchema` gives.
  nachweis_stand: FLEinwilligungStandSchema,
  // The floor the seat's confirmation page named, over every seat held on the row: served, never
  // recomputed here from the roles, so the two tiers cannot name different ages.
  mindestalter: z.number().int(),
  medien_angeboten: z.boolean(),
  erteilbar: z.boolean(),
  kontext: FLSitzKontextSchema,
});
export type FLKontoSitzEinwilligung = z.infer<typeof FLKontoSitzEinwilligungSchema>;

/**
 * Mirrors `FLKontoBewerbungSitzEinwilligung`: one pending application on which the person holds a
 * confirmed seat. Its choices can only be withdrawn here; an accepted application's seats are listed
 * under `sitze` instead.
 */
export const FLKontoBewerbungSitzEinwilligungSchema = z.object({
  bewerbung_id: CustomObjectIdStringSchema,
  // As served: the school the application names, or the picked club's name today.
  schule: z.string(),
  saison_id: z.string(),
  rollen: z.array(FLKontaktRolleSchema).nonempty(),
  // For `FLKontoSitzEinwilligungSchema`'s reason.
  bestaetigt_text_version: z.string().nullable(),
  umfang: FLKontaktKenntnisnahmeSchema.shape.umfang,
  medien: z.boolean(),
  nachweis_stand: FLEinwilligungStandSchema,
  // For `FLKontoSitzEinwilligungSchema`'s reason.
  mindestalter: z.number().int(),
  kontext: FLSitzKontextSchema,
});
export type FLKontoBewerbungSitzEinwilligung = z.infer<typeof FLKontoBewerbungSitzEinwilligungSchema>;

/**
 * Mirrors `FLKontoRegistrierungEinwilligung`: one pending registration its pupil confirmed, its stored data
 * beside it. Withdraw-only until admitted, so no `erteilbar`; a returning pupil's asks no choice, so both
 * are null and the page offers no control.
 */
export const FLKontoRegistrierungEinwilligungSchema = z.object({
  registrierung_id: CustomObjectIdStringSchema,
  team_id: CustomObjectIdStringSchema,
  // Null where the team the registration names is gone.
  team_name: z.string().nullable(),
  saison_id: z.string(),
  // For `FLKontoSitzEinwilligungSchema`'s reason.
  bestaetigt_text_version: z.string().nullable(),
  umfang: FLEinwilligungSchema.shape.umfang.nullable(),
  medien: z.boolean().nullable(),
  nachweis_stand: FLEinwilligungStandSchema,
  kontext: FLSpielerKontextSchema,
  vorname: z.string(),
  nachname: z.string(),
  geburtsdatum: CustomDateStringSchema.nullable(),
  nummer: z.string().nullable(),
  position: FLSpielerPositionSchema.nullable(),
  stufe: FLSpielerStufeSchema.nullable(),
});
export type FLKontoRegistrierungEinwilligung = z.infer<typeof FLKontoRegistrierungEinwilligungSchema>;

/**
 * Mirrors `FLKontoEinwilligungenResponse`, the account page's one read of every confirmed consent the
 * address holds. Empty rather than refused where nothing is held: the page renders for every person.
 */
export const FLKontoEinwilligungenResponseSchema = BaseAPIResponseSchema.extend({
  spieler: FLSpielerSelbstSchema.nullable(),
  schiedsrichter: z.array(FLSchiedsrichterSelbstSchema),
  sitze: z.array(FLKontoSitzEinwilligungSchema),
  bewerbungen: z.array(FLKontoBewerbungSitzEinwilligungSchema),
  registrierungen: z.array(FLKontoRegistrierungEinwilligungSchema),
});
export type FLKontoEinwilligungenResponse = z.infer<typeof FLKontoEinwilligungenResponseSchema>;
