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

export type FLSubjektSitz = wire.FLSubjektSitz;
export type FLSubjektSpieler = wire.FLSubjektSpieler;
export type FLSubjektSchiedsrichter = wire.FLSubjektSchiedsrichter;
export type FLSubjektResponse = wire.FLSubjektResponse;

export type FLGesperrtPayload = wire.FLGesperrtPayload;
export const FLGesperrtResponseSchema = z.custom<wire.FLGesperrtResponse>();

export type FLEinwilligungFassung = wire.FLEinwilligungFassung;

// Redesign: the object below goes with its last importer, `fl_frontend/src/core/funktionen.test.ts`, which reads a
// seat's season states. It `satisfies` the generated type, so a backend change that moves it fails the type check here.

export const FLSubjektSitzSchema = z.object({
  saison_id: z.string(),
  team_id: CustomObjectIdStringSchema,
  rolle: z.enum(["trainer", "ansprechperson", "stellvertretung"]),
  team_name: z.string(),
  saison_status: z.enum(["past", "active", "future"]),
}) satisfies z.ZodType<FLSubjektSitz>;
