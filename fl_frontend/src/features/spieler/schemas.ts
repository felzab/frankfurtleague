import z from "zod";

import { FLSpielerPosition, FLSpielerRolle, FLSpielerStufe } from "@/core/generated/client/types";
import { SAISON_ID_LENGTH } from "@/features/saisons/constants";
import { CustomObjectIdStringSchema } from "@/shared/schemas";

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

// Named rather than written into the field below.
const SQUAD_NUMMER_REGEX = /^\d{1,4}$/;

/** The three ids a squad row is addressed by on a seat holder's write, all of them in the PATH. */
const kaderRowKeyFields = {
  team_id: CustomObjectIdStringSchema,
  saison_id: z.string().length(SAISON_ID_LENGTH, { error: "Bitte wähle eine Saison." }),
  spieler_id: CustomObjectIdStringSchema,
};

// Redesign: goes with its last importer.
/**
 * Mirrors `FLPatchKaderRowPayload`, wholesale: an omitted field would erase a stored one. The club
 * and the Nachnominierung are the stored row's, and a seat holder's write names neither.
 */
export const FLPatchKaderRowPayloadSchema = z.object({
  ...kaderRowKeyFields,
  nummer: z.string().regex(SQUAD_NUMMER_REGEX, { error: NUMMER_MUST_BE_DIGITS }).nullable(),
  position: FLSpielerPositionSchema.nullable(),
  stufe: FLSpielerStufeSchema.nullable(),
  rolle: FLSpielerRolleSchema.nullable(),
});
export type FLPatchKaderRowPayload = z.infer<typeof FLPatchKaderRowPayloadSchema>;

// Redesign: goes with its last importer.
/** The austragen's whole argument: the row's three ids, every one in the path, and no request body. */
export const FLKaderRowKeyPayloadSchema = z.object(kaderRowKeyFields);
export type FLKaderRowKeyPayload = z.infer<typeof FLKaderRowKeyPayloadSchema>;

// Redesign: goes with its last importer.
/**
 * The labels a press names, one per choice, each the one its kind's wording carries
 * (`fl_frontend/src/core/consentWordings.ts`): only a drifted page sends another, which `error` tells to reload.
 */
export const textVersionsSchema = <U extends string, M extends string>(labels: { readonly scope: U; readonly media: M }, error: string) =>
  z.object({ scope: z.literal(labels.scope, { error }), media: z.literal(labels.media, { error }) }, { error });

/** A drifted link page's labels, which the link reopened repairs. */
export const LINK_WORDING_MISSING = "Deine Antwort nennt keine Fassung. Öffne den Link aus Deiner E-Mail erneut.";
