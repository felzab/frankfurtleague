import z from "zod";

import { CustomObjectIdStringSchema } from "./objectId";

import type * as wire from "./generated/client/types";

// Each name below is the backend's own type, generated from `fl_backend/openapi.json`; a `*Schema` the hand-written
// calls hand `fl_frontend/src/core/api.ts :: apiClient` types the answer and parses nothing. A type-only import, so a
// client component may import a type from here without the generated modules' `server-only`.

/**
 * Redesign: goes with its last importer. The envelope every slice's hand-written answer extends; the backend's answers
 * carry no field of it.
 */
export const BaseAPIResponseSchema = z.object({});

export type FLRefusedField = wire.FLRefusedField;

export type FLSubjektPayload = wire.FLSubjektPayload;
export type FLSubjektSitz = wire.FLSubjektSitz;
export type FLSubjektSpieler = wire.FLSubjektSpieler;
export type FLSubjektSchiedsrichter = wire.FLSubjektSchiedsrichter;
export type FLSubjektResponse = wire.FLSubjektResponse;

export type FLAnmeldungResponse = wire.FLAnmeldungResponse;
export const FLAnmeldungResponseSchema = z.custom<FLAnmeldungResponse>();

export type FLGesperrtPayload = wire.FLGesperrtPayload;
export const FLGesperrtResponseSchema = z.custom<wire.FLGesperrtResponse>();

export type FLEinwilligungFassung = wire.FLEinwilligungFassung;
export const FLEinwilligungFassungResponseSchema = z.custom<wire.FLEinwilligungFassungResponse>();
export const FLEinwilligungSeitenResponseSchema = z.custom<wire.FLEinwilligungSeitenResponse>();

export type FLErasureResponse = wire.FLErasureResponse;
export const FLErasureResponseSchema = z.custom<FLErasureResponse>();

export type FLSelbstErasureAnsichtResponse = wire.FLSelbstErasureAnsichtResponse;
export const FLSelbstErasureAnsichtResponseSchema = z.custom<FLSelbstErasureAnsichtResponse>();

// Redesign: the objects below go with their last importers, which compose them: `fl_frontend/src/features/funktionen/
// schemas.ts` extends the erasure's rows and reads the grant's tier, `fl_frontend/src/core/funktionen.test.ts` reads a
// seat's season states. Each `satisfies` the generated type, so a backend change that moves one fails the type check
// here.

export const FLSubjektSitzSchema = z.object({
  saison_id: z.string(),
  team_id: CustomObjectIdStringSchema,
  rolle: z.enum(["trainer", "ansprechperson", "stellvertretung"]),
  team_name: z.string(),
  saison_status: z.enum(["past", "active", "future"]),
}) satisfies z.ZodType<FLSubjektSitz>;

export const FLSubjektResponseSchema = z.object({
  sitze: z.array(FLSubjektSitzSchema),
  spieler: z.array(z.object({ spieler_id: CustomObjectIdStringSchema })),
  schiedsrichter: z.array(z.object({ schiedsrichter_id: CustomObjectIdStringSchema })),
  unbestaetigt: z.boolean(),
  gesperrt: z.boolean(),
  verwaltung: z.enum(["owner", "administration"]).nullable(),
  berechtigt_seit: z.string().nullable(),
  inhaber_seit: z.string().nullable(),
}) satisfies z.ZodType<FLSubjektResponse>;

export const FLSelbstErasureSpielerSchema = z.object({
  vorname: z.string(),
  nachname: z.string().nullable(),
}) satisfies z.ZodType<wire.FLSelbstErasureSpieler>;

export const FLSelbstErasureSchiedsrichterSchema = z.object({
  name: z.string().nullable(),
}) satisfies z.ZodType<wire.FLSelbstErasureSchiedsrichter>;

export const FLSelbstErasureSitzSchema = z.object({
  saison_id: z.string(),
  team_name: z.string(),
  rolle: FLSubjektSitzSchema.shape.rolle,
  vorname: z.string(),
  nachname: z.string(),
}) satisfies z.ZodType<wire.FLSelbstErasureSitz>;

export const FLSelbstErasureBewerbungSchema = z.object({
  saison_id: z.string(),
  rolle: FLSubjektSitzSchema.shape.rolle,
  vorname: z.string(),
  nachname: z.string(),
}) satisfies z.ZodType<wire.FLSelbstErasureBewerbung>;

export const FLSelbstErasureRegistrierungSchema = z.object({
  saison_id: z.string(),
  team_name: z.string().nullable(),
  vorname: z.string(),
  nachname: z.string(),
}) satisfies z.ZodType<wire.FLSelbstErasureRegistrierung>;
