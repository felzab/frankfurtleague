import z from "zod";

import { FLSpielerPosition, FLSpielerRolle, FLSpielerStufe } from "@/core/generated/client/types";
import { SAISON_ID_LENGTH } from "@/features/saisons/constants";
import { KONTAKT_NAME_MAX_LENGTH, KONTAKT_NAME_ZU_LANG } from "@/features/teams/constants";
import { CustomDateStringSchema, CustomObjectIdStringSchema, PersonNameSchema } from "@/shared/schemas";

import { NUMMER_MUST_BE_DIGITS } from "./constants";

// Redesign: goes with its last importer.
/**
 * German error because the squad editor's picker binds this directly; an untouched picker submits null, which this
 * refuses and the nullable wrappers below allow.
 */
export const FLSpielerPositionSchema = z.enum(FLSpielerPosition, { error: "Bitte wähle eine Position." });

// Redesign: goes with its last importer.
export const FLSpielerStufeSchema = z.enum(FLSpielerStufe, { error: "Bitte wähle eine Stufe." });

// Redesign: goes with its last importer.
/**
 * Slugs, so `ROLLE_OPTIONS` owns the German the reader sees; a squad holds each of these once, which the write path
 * refuses on (`kader_rolle_taken`).
 */
const FLSpielerRolleSchema = z.enum(FLSpielerRolle, { error: "Bitte wähle eine Rolle." });

// Redesign: goes with its last importer.
/**
 * Replaces the person's own fields wholesale, so none is optional: an omitted surname would erase a
 * stored one.
 *
 * No uniqueness rule on a name — two people genuinely can share one.
 */
export const FLPatchSpielerPayloadSchema = z.object({
  id: CustomObjectIdStringSchema,
  vorname: PersonNameSchema.max(KONTAKT_NAME_MAX_LENGTH, { error: KONTAKT_NAME_ZU_LANG }),
  // The form submits null for an empty box, never an empty string — a surname often arrives later.
  nachname: PersonNameSchema.max(KONTAKT_NAME_MAX_LENGTH, { error: KONTAKT_NAME_ZU_LANG }).nullable(),
  // Never null: a save clearing the date the person's registration carried would leave one whose age
  // no page can read.
  geburtsdatum: CustomDateStringSchema,
});
export type FLPatchSpielerPayload = z.infer<typeof FLPatchSpielerPayloadSchema>;

// Redesign: goes with its last importer.
export const FLDeleteSpielerPayloadSchema = z.object({
  id: CustomObjectIdStringSchema,
});
export type FLDeleteSpielerPayload = z.infer<typeof FLDeleteSpielerPayloadSchema>;

// Redesign: goes with its last importer.
export const FLReactivateSpielerPayloadSchema = z.object({
  id: CustomObjectIdStringSchema,
});
export type FLReactivateSpielerPayload = z.infer<typeof FLReactivateSpielerPayloadSchema>;

// Named rather than written into the field below.
const SQUAD_NUMMER_REGEX = /^\d{1,4}$/;

/**
 * No transforms — empty-to-null normalisation is the FORM boundary's. A schema that rewrote its
 * input would make `z.infer` disagree with what the form holds, which the squad editor's draft is typed by.
 */
const saisonSpielerPayloadFields = {
  team_id: CustomObjectIdStringSchema,
  // A string on the wire — worn rather than counted — but free text was never meant to admit a name.
  nummer: z.string().regex(SQUAD_NUMMER_REGEX, { error: NUMMER_MUST_BE_DIGITS }).nullable(),
  position: FLSpielerPositionSchema.nullable(),
  stufe: FLSpielerStufeSchema.nullable(),
  // On the junction: a role is held within one team for one season, not by the person. One field and
  // not a flag per role, so holding both at once cannot be expressed.
  rolle: FLSpielerRolleSchema.nullable(),
};

// Redesign: goes with its last importer.
export const FLPostSaisonSpielerPayloadSchema = z.object({
  // In the PATH on the wire; carried here because the form has to know which player it is entering.
  spieler_id: CustomObjectIdStringSchema,
  saison_id: z.string().length(SAISON_ID_LENGTH, { error: "Bitte wähle eine Saison." }),
  ...saisonSpielerPayloadFields,
});
export type FLPostSaisonSpielerPayload = z.infer<typeof FLPostSaisonSpielerPayloadSchema>;

// Redesign: goes with its last importer.
export const FLPatchSaisonSpielerPayloadSchema = z.object({
  // Both ids are in the PATH on the wire — the junction row is addressed by its natural key.
  spieler_id: CustomObjectIdStringSchema,
  saison_id: z.string().length(SAISON_ID_LENGTH, { error: "Bitte wähle eine Saison." }),
  ...saisonSpielerPayloadFields,
});
export type FLPatchSaisonSpielerPayload = z.infer<typeof FLPatchSaisonSpielerPayloadSchema>;

// Redesign: goes with its last importer.
/** The junction row's natural key, for the two endpoints that carry no body. */
export const FLSaisonSpielerKeyPayloadSchema = z.object({
  spieler_id: CustomObjectIdStringSchema,
  saison_id: z.string().length(SAISON_ID_LENGTH, { error: "Bitte wähle eine Saison." }),
});
export type FLSaisonSpielerKeyPayload = z.infer<typeof FLSaisonSpielerKeyPayloadSchema>;

/** The three ids a squad row is addressed by on a seat holder's write, all of them in the PATH. */
const kaderZeileKeyFields = {
  team_id: CustomObjectIdStringSchema,
  saison_id: z.string().length(SAISON_ID_LENGTH, { error: "Bitte wähle eine Saison." }),
  spieler_id: CustomObjectIdStringSchema,
};

// Redesign: goes with its last importer.
/**
 * Mirrors `FLPatchKaderRowPayload`, wholesale: an omitted field would erase a stored one. The club
 * and the Nachnominierung are the stored row's, and a seat holder's write names neither.
 */
export const FLPatchKaderZeilePayloadSchema = z.object({
  ...kaderZeileKeyFields,
  nummer: z.string().regex(SQUAD_NUMMER_REGEX, { error: NUMMER_MUST_BE_DIGITS }).nullable(),
  position: FLSpielerPositionSchema.nullable(),
  stufe: FLSpielerStufeSchema.nullable(),
  rolle: FLSpielerRolleSchema.nullable(),
});
export type FLPatchKaderRowPayload = z.infer<typeof FLPatchKaderZeilePayloadSchema>;

// Redesign: goes with its last importer.
/** The austragen's whole argument: the row's three ids, every one in the path, and no request body. */
export const FLKaderZeileKeyPayloadSchema = z.object(kaderZeileKeyFields);
export type FLKaderZeileKeyPayload = z.infer<typeof FLKaderZeileKeyPayloadSchema>;

// Redesign: goes with its last importer.
/**
 * The labels a press names, one per choice, each the one its kind's wording carries
 * (`fl_frontend/src/core/consentWordings.ts`): only a drifted page sends another, which `error` tells to reload.
 */
export const textVersionsSchema = <U extends string, M extends string>(labels: { readonly umfang: U; readonly media: M }, error: string) =>
  z.object({ umfang: z.literal(labels.umfang, { error: error }), media: z.literal(labels.media, { error: error }) }, { error: error });

/** A drifted link page's labels, which the link reopened repairs. */
export const LINK_FASSUNG_FEHLT = "Deine Antwort nennt keine Fassung. Öffne den Link aus Deiner E-Mail erneut.";
