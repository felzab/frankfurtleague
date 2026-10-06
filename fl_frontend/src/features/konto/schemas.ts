import z from "zod";

import { BaseAPIResponseSchema } from "@/core/schemas";
import { FLKontaktRolleSchema } from "@/features/bewerbungen/schemas";
import { FLSchiedsrichterKontextSchema, FLSchiedsrichterSelbstSchema } from "@/features/schiedsrichter/schemas";
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
 * Mirrors `FLSitzBestaetigt`: one confirmation the seats held on a row stand on, its own roles, words,
 * day and age floor. A Trainer who took a second seat later confirmed twice, under two floors.
 */
export const FLSitzBestaetigtSchema = z.object({
  rollen: z.array(FLKontaktRolleSchema).nonempty(),
  // The label whose words the account page shows: the backend names it, so the page never decides it
  // from the record's shape.
  text_version: z.string().nullable(),
  bestaetigt_am: CustomDateStringSchema.nullable(),
  // The floor that confirmation page named, served so the two tiers cannot name different ages.
  mindestalter: z.number().int(),
  kontext: FLSitzKontextSchema,
});
export type FLSitzBestaetigt = z.infer<typeof FLSitzBestaetigtSchema>;

/**
 * Mirrors `FLKontoSitzEinwilligung`: one entry per team season, however many of its seats the person
 * holds, because one press moves both choices on every one of them.
 */
export const FLKontoSitzEinwilligungSchema = z.object({
  team_id: CustomObjectIdStringSchema,
  team_name: z.string(),
  saison_id: z.string(),
  rollen: z.array(FLKontaktRolleSchema).nonempty(),
  umfang: FLKontaktKenntnisnahmeSchema.shape.umfang,
  medien: z.boolean(),
  // The consent press's precondition, for the reason `FLKontoSpielerEinwilligungSchema` gives.
  nachweis_stand: FLEinwilligungStandSchema,
  medien_angeboten: z.boolean(),
  erteilbar: z.boolean(),
  // One per entry, never per confirmation: every confirmation's words and the control's name one media floor.
  medien_mindestalter: z.number().int(),
  bestaetigt: z.array(FLSitzBestaetigtSchema).nonempty(),
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
  umfang: FLKontaktKenntnisnahmeSchema.shape.umfang,
  medien: z.boolean(),
  nachweis_stand: FLEinwilligungStandSchema,
  // For `FLKontoSitzEinwilligungSchema`'s reason.
  medien_mindestalter: z.number().int(),
  bestaetigt: z.array(FLSitzBestaetigtSchema).nonempty(),
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
  // For `FLKontoSpielerEinwilligungSchema`'s reason.
  bestaetigt_text_version: z.string().nullable(),
  umfang: FLEinwilligungSchema.shape.umfang.nullable(),
  medien: z.boolean().nullable(),
  nachweis_stand: FLEinwilligungStandSchema,
  // For `FLKontoSpielerEinwilligungSchema`'s reason, both.
  mindestalter: z.number().int(),
  medien_mindestalter: z.number().int(),
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
 * Mirrors `FLKontoSpielerEinwilligung`: the pupil's record on the account page, its stored data and the
 * consent the page moves.
 */
export const FLKontoSpielerEinwilligungSchema = FLSpielerSelbstSchema.extend({
  inactive_since: CustomDateStringSchema.nullable(),
  // Never null here: the read serves confirmed records alone, an unconfirmed one holding nothing to withdraw.
  einwilligung: FLEinwilligungSchema,
  // The label whose words the page shows beside the control: the backend names which stored label the
  // person confirmed, so the page never decides it from the record's shape.
  bestaetigt_text_version: z.string().nullable(),
  // What the consent press sends back as its precondition, so a press from a page another tab has since
  // moved is refused rather than undoing that tab's choice.
  nachweis_stand: FLEinwilligungStandSchema,
  // The backend's verdicts, never recomputed here: a second clock or a second reading of a panel would
  // offer a press the write refuses.
  erteilbar: z.boolean(),
  medien_angeboten: z.boolean(),
  // The floors the record's confirmation page named, served as every seat entry's are, so the two tiers
  // cannot name different ages.
  mindestalter: z.number().int(),
  medien_mindestalter: z.number().int(),
  kontext: FLSpielerKontextSchema,
});
export type FLKontoSpielerEinwilligung = z.infer<typeof FLKontoSpielerEinwilligungSchema>;

/** Mirrors `FLKontoSchiedsrichterEinwilligung`: one referee record on the account page, for the pupil's entry's reasons. */
export const FLKontoSchiedsrichterEinwilligungSchema = FLSchiedsrichterSelbstSchema.extend({
  inactive_since: CustomDateStringSchema.nullable(),
  einwilligung: FLEinwilligungSchema,
  bestaetigt_text_version: z.string().nullable(),
  nachweis_stand: FLEinwilligungStandSchema,
  erteilbar: z.boolean(),
  medien_angeboten: z.boolean(),
  mindestalter: z.number().int(),
  medien_mindestalter: z.number().int(),
  kontext: FLSchiedsrichterKontextSchema,
});
export type FLKontoSchiedsrichterEinwilligung = z.infer<typeof FLKontoSchiedsrichterEinwilligungSchema>;

/**
 * Mirrors `FLKontoEinwilligungenResponse`, the account page's one read of every confirmed consent the
 * address holds. Empty rather than refused where nothing is held: the page renders for every person.
 */
export const FLKontoEinwilligungenResponseSchema = BaseAPIResponseSchema.extend({
  spieler: FLKontoSpielerEinwilligungSchema.nullable(),
  schiedsrichter: z.array(FLKontoSchiedsrichterEinwilligungSchema),
  sitze: z.array(FLKontoSitzEinwilligungSchema),
  bewerbungen: z.array(FLKontoBewerbungSitzEinwilligungSchema),
  registrierungen: z.array(FLKontoRegistrierungEinwilligungSchema),
});
export type FLKontoEinwilligungenResponse = z.infer<typeof FLKontoEinwilligungenResponseSchema>;
